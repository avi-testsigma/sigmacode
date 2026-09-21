import * as Effect from "effect/Effect";

import { runStackCommand } from "./stackCommand.ts";
import {
  StackContainerStartError,
  StackContainersMissingError,
  StackDockerUnavailableError,
} from "./StackErrors.ts";

const listContainerNames = (args: ReadonlyArray<string>) =>
  runStackCommand(["docker", ...args, "--format", "{{.Names}}"]).pipe(
    Effect.flatMap((result) =>
      result.exitCode === 0
        ? Effect.succeed(
            new Set(
              result.stdout
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.length > 0),
            ),
          )
        : Effect.fail(new StackDockerUnavailableError({ output: result.stderr.trim() })),
    ),
  );

/**
 * Make sure every container the stack needs is running, starting any that are
 * stopped. It never creates one: a container that does not exist yet means the
 * machine was never provisioned, which is first-run territory, not a fault to
 * paper over.
 */
export const ensureContainers = (names: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (names.length === 0) {
      return;
    }
    const existing = yield* listContainerNames(["ps", "-a"]);
    const missing = names.filter((name) => !existing.has(name));
    if (missing.length > 0) {
      return yield* new StackContainersMissingError({ missing });
    }
    const running = yield* listContainerNames(["ps"]);
    for (const name of names) {
      if (running.has(name)) {
        continue;
      }
      yield* Effect.logInfo("arcus.stack.containerStarting", { name });
      const started = yield* runStackCommand(["docker", "start", name]);
      if (started.exitCode !== 0) {
        return yield* new StackContainerStartError({ name, output: started.stderr.trim() });
      }
    }
  });
