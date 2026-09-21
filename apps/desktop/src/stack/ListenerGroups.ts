import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import { runStackCommand } from "./stackCommand.ts";

const STOP_GRACE = Duration.seconds(10);
const STOP_POLL = Duration.millis(250);

const firstInteger = (text: string): number | null => {
  const value = Number.parseInt(text.trim().split("\n")[0] ?? "", 10);
  return Number.isFinite(value) && value > 1 ? value : null;
};

/**
 * Only the LISTENER, never every holder of the port: matching clients too would
 * take down anything connected to the service, such as the UI talking to the API.
 */
const listenerPid = (port: number) =>
  runStackCommand(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).pipe(
    Effect.map((result) => (result.exitCode === 0 ? firstInteger(result.stdout) : null)),
  );

const processGroupOf = (pid: number) =>
  runStackCommand(["ps", "-o", "pgid=", "-p", String(pid)]).pipe(
    Effect.map((result) => (result.exitCode === 0 ? firstInteger(result.stdout) : null)),
  );

const signalGroup = (pgid: number, signal: NodeJS.Signals) =>
  Effect.sync(() => {
    try {
      process.kill(-pgid, signal);
    } catch {
      // Already gone between the lookup and the signal.
    }
  });

/**
 * Stop whatever is listening on a port by signalling its whole process group,
 * so a parent such as `next dev` goes with its server. Used for services the
 * app adopted rather than spawned. Refuses to touch the app's own group.
 */
export const stopListenerGroup = (port: number) =>
  Effect.gen(function* () {
    const pid = yield* listenerPid(port);
    if (pid === null) {
      return;
    }
    const pgid = yield* processGroupOf(pid);
    const ownGroup = yield* processGroupOf(process.pid);
    if (pgid === null || pgid === ownGroup) {
      return;
    }
    yield* signalGroup(pgid, "SIGTERM");
    const released = yield* Effect.gen(function* () {
      while ((yield* listenerPid(port)) !== null) {
        yield* Effect.sleep(STOP_POLL);
      }
    }).pipe(Effect.timeoutOption(STOP_GRACE));
    if (released._tag === "None") {
      yield* signalGroup(pgid, "SIGKILL");
    }
  });
