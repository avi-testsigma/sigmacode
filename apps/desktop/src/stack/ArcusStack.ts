import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ensureContainers } from "./Containers.ts";
import { runFixer } from "./Fixers.ts";
import { isHealthy, waitUntilHealthy } from "./Health.ts";
import { stopListenerGroup } from "./ListenerGroups.ts";
import { runStackCommand } from "./stackCommand.ts";
import { StackBuildError, StackCommandError } from "./StackErrors.ts";
import {
  expandPlaceholders,
  type StackManifest,
  type StackPaths,
  type StackService,
} from "./StackManifest.ts";

const SUPERVISE_INTERVAL = Duration.seconds(5);
const SERVICE_STOP_GRACE = Duration.seconds(10);
const RESTART_WINDOW_MS = 5 * 60_000;
const MAX_RESTARTS_IN_WINDOW = 3;
// An adopted service is not ours to watch by pid, so a few missed checks in a
// row, not one, is what counts as gone: a single slow probe is not a crash.
const ADOPTED_MISSES_BEFORE_RESTART = 3;
const BUILD_OUTPUT_TAIL = 4000;

interface ServiceRun {
  readonly scope: Scope.Closeable;
  readonly handle: ChildProcessSpawner.ChildProcessHandle;
}

interface ServiceState {
  /** Set while this app spawned the process and owns its lifetime. */
  readonly run: ServiceRun | null;
  /** Set when a healthy instance was already running and was taken over, not duplicated. */
  readonly adopted: boolean;
  readonly misses: number;
  readonly restartedAt: ReadonlyArray<number>;
  readonly givenUp: boolean;
}

const INITIAL_STATE: ServiceState = {
  run: null,
  adopted: false,
  misses: 0,
  restartedAt: [],
  givenUp: false,
};

export interface ArcusStack {
  /** Bring the stack up, then supervise it until interrupted. */
  readonly run: Effect.Effect<void>;
  /** Stop every service, spawned or adopted, in reverse start order. */
  readonly stop: Effect.Effect<void>;
}

/**
 * The deterministic half of healing: start order, adoption, restarts with a
 * budget, and the manifest's named repairs. It never spends tokens. When a
 * service exhausts its budget it is left for the agent to diagnose.
 */
export const makeArcusStack = Effect.fn("arcus.stack.make")(function* (input: {
  readonly manifest: StackManifest;
  readonly paths: StackPaths;
  readonly logDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  // Captured so run and stop can be forked and finalized without dragging these requirements along.
  const services = yield* Effect.context<
    | FileSystem.FileSystem
    | Path.Path
    | ChildProcessSpawner.ChildProcessSpawner
    | HttpClient.HttpClient
  >();
  const states = yield* Ref.make<ReadonlyMap<string, ServiceState>>(
    new Map(input.manifest.services.map((service) => [service.id, INITIAL_STATE])),
  );
  const expand = (value: string) => expandPlaceholders(value, input.paths);

  const stateOf = (id: string) =>
    Ref.get(states).pipe(Effect.map((all) => all.get(id) ?? INITIAL_STATE));
  const updateState = (id: string, patch: Partial<ServiceState>) =>
    Ref.update(states, (all) =>
      new Map(all).set(id, { ...(all.get(id) ?? INITIAL_STATE), ...patch }),
    );

  const ensureBuilt = Effect.fn("arcus.stack.ensureBuilt")(function* (service: StackService) {
    if (service.build === undefined) {
      return;
    }
    const output = expand(service.build.output);
    if (yield* fs.exists(output)) {
      return;
    }
    yield* fs.makeDirectory(path.dirname(output), { recursive: true });
    yield* Effect.logInfo("arcus.stack.building", { service: service.id });
    const built = yield* runStackCommand(service.build.run.map(expand), {
      cwd: expand(service.cwd),
    });
    if (built.exitCode !== 0) {
      return yield* new StackBuildError({
        service: service.id,
        output: built.stderr.slice(-BUILD_OUTPUT_TAIL),
      });
    }
  });

  const spawnService = Effect.fn("arcus.stack.spawn")(function* (service: StackService) {
    const [executable, ...args] = service.run.map(expand);
    if (executable === undefined) {
      return yield* new StackCommandError({ argv: service.run, cause: "empty command" });
    }
    yield* fs.makeDirectory(input.logDir, { recursive: true });
    const scope = yield* Scope.make("sequential");
    const handle = yield* spawner
      .spawn(
        ChildProcess.make(executable, args, {
          cwd: expand(service.cwd),
          // A stale cmux shim left in NODE_OPTIONS breaks every node invocation.
          env: { ...service.env, NODE_OPTIONS: "" },
          extendEnv: true,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          killSignal: "SIGTERM",
          forceKillAfter: SERVICE_STOP_GRACE,
        }),
      )
      .pipe(
        Scope.provide(scope),
        Effect.onError(() => Scope.close(scope, Exit.void)),
      );
    const logPath = path.join(input.logDir, `${service.id}.log`);
    yield* Effect.forkIn(
      handle.all.pipe(Stream.run(fs.sink(logPath, { flag: "a" })), Effect.ignore),
      scope,
    );
    return { scope, handle } satisfies ServiceRun;
  });

  const startService = Effect.fn("arcus.stack.start")(function* (service: StackService) {
    for (const fixer of service.preStart ?? []) {
      yield* runFixer(fixer);
    }
    yield* ensureBuilt(service);
    const run = yield* spawnService(service);
    yield* updateState(service.id, { run, adopted: false, misses: 0 });
    yield* Effect.logInfo("arcus.stack.serviceStarted", {
      service: service.id,
      pid: run.handle.pid,
    });
    yield* waitUntilHealthy({
      service: service.id,
      url: service.health.url,
      timeoutSec: service.health.timeoutSec,
    });
    yield* Effect.logInfo("arcus.stack.serviceHealthy", { service: service.id });
  });

  // A service that fails to start or stay healthy is logged and left to the
  // supervisor's next pass, so one broken service never blocks the others.
  const startLogged = (service: StackService) =>
    startService(service).pipe(
      Effect.catch((error) =>
        Effect.logError("arcus.stack.serviceStartFailed", {
          service: service.id,
          reason: error.message,
        }),
      ),
    );

  const restart = Effect.fn("arcus.stack.restart")(function* (service: StackService) {
    const now = yield* Clock.currentTimeMillis;
    const state = yield* stateOf(service.id);
    const recent = state.restartedAt.filter((at) => now - at < RESTART_WINDOW_MS);
    if (recent.length >= MAX_RESTARTS_IN_WINDOW) {
      yield* updateState(service.id, { run: null, givenUp: true });
      yield* Effect.logError("arcus.stack.serviceGaveUp", {
        service: service.id,
        restarts: recent.length,
      });
      return;
    }
    yield* updateState(service.id, { run: null, adopted: false, restartedAt: [...recent, now] });
    yield* Effect.logWarning("arcus.stack.serviceRestarting", {
      service: service.id,
      attempt: recent.length + 1,
    });
    yield* startLogged(service);
  });

  const superviseService = Effect.fn("arcus.stack.supervise")(function* (service: StackService) {
    const state = yield* stateOf(service.id);
    if (state.givenUp) {
      return;
    }
    if (state.run !== null) {
      const alive = yield* state.run.handle.isRunning.pipe(
        Effect.catch(() => Effect.succeed(false)),
      );
      if (alive) {
        return;
      }
      yield* Effect.logWarning("arcus.stack.serviceExited", { service: service.id });
      yield* Scope.close(state.run.scope, Exit.void);
      yield* restart(service);
      return;
    }
    if (yield* isHealthy(service.health.url)) {
      yield* updateState(service.id, { misses: 0 });
      return;
    }
    const misses = state.misses + 1;
    if (state.adopted && misses < ADOPTED_MISSES_BEFORE_RESTART) {
      yield* updateState(service.id, { misses });
      return;
    }
    yield* restart(service);
  });

  const ensureContainersLogged = ensureContainers(
    input.manifest.containers.map((container) => container.name),
  ).pipe(
    Effect.catch((error) =>
      Effect.logWarning("arcus.stack.containersUnavailable", { reason: error.message }),
    ),
  );

  const bringUp = Effect.gen(function* () {
    yield* ensureContainersLogged;
    for (const service of input.manifest.services) {
      if (yield* isHealthy(service.health.url)) {
        yield* updateState(service.id, { adopted: true });
        yield* Effect.logInfo("arcus.stack.serviceAdopted", { service: service.id });
        continue;
      }
      yield* startLogged(service);
    }
  });

  const superviseForever = Effect.forever(
    Effect.sleep(SUPERVISE_INTERVAL).pipe(
      Effect.andThen(ensureContainersLogged),
      Effect.andThen(Effect.forEach(input.manifest.services, superviseService, { discard: true })),
    ),
  );

  const stop = Effect.gen(function* () {
    for (const service of [...input.manifest.services].reverse()) {
      const state = yield* stateOf(service.id);
      if (state.run !== null) {
        yield* Scope.close(state.run.scope, Exit.void);
      } else if (state.adopted) {
        yield* stopListenerGroup(service.port).pipe(Effect.ignore);
      }
      yield* Effect.logInfo("arcus.stack.serviceStopped", { service: service.id });
    }
  });

  return {
    run: bringUp.pipe(Effect.andThen(superviseForever), Effect.provide(services)),
    stop: stop.pipe(Effect.provide(services)),
  } satisfies ArcusStack;
});
