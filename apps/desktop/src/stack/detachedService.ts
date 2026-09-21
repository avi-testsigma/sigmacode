// @effect-diagnostics nodeBuiltinImport:off -- A service writes its log straight to a file so it outlives the supervisor; Effect's process API only offers piped output.
import * as NodeChildProcess from "node:child_process";
import * as NodeFs from "node:fs";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { StackCommandError } from "./StackErrors.ts";

const STOP_POLL = Duration.millis(250);

export interface DetachedService {
  readonly pid: number;
  /** Whether the service process itself is still alive. */
  readonly isRunning: Effect.Effect<boolean>;
  /** Signal the whole process group, then force it once the grace period runs out. */
  readonly stop: (grace: Duration.Duration) => Effect.Effect<void>;
}

const signal = (target: number, name: NodeJS.Signals | 0): boolean => {
  try {
    process.kill(target, name);
    return true;
  } catch {
    return false;
  }
};

const stopGroup = (pgid: number, grace: Duration.Duration) =>
  Effect.gen(function* () {
    signal(-pgid, "SIGTERM");
    const emptied = yield* Effect.gen(function* () {
      while (signal(-pgid, 0)) {
        yield* Effect.sleep(STOP_POLL);
      }
    }).pipe(Effect.timeoutOption(grace));
    if (Option.isNone(emptied)) {
      signal(-pgid, "SIGKILL");
    }
  });

/**
 * Start a service in its own process group with its output appended straight
 * to a log file. Nothing ties it to the supervisor, no pipe and no inherited
 * handle, so a supervisor that dies or is force-quit leaves it running and
 * healthy for the next launch to adopt. A pipe would break that: the service
 * would hang or die on its next log line once nobody was reading it.
 */
export const spawnDetachedService = (input: {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly logPath: string;
}): Effect.Effect<DetachedService, StackCommandError> =>
  Effect.callback<DetachedService, StackCommandError>((resume) => {
    const argv = [input.executable, ...input.args];
    let child: NodeChildProcess.ChildProcess;
    const logFd = NodeFs.openSync(input.logPath, "a");
    try {
      child = NodeChildProcess.spawn(input.executable, [...input.args], {
        cwd: input.cwd,
        env: { ...process.env, ...input.env },
        detached: true,
        stdio: ["ignore", logFd, logFd],
      });
    } catch (cause) {
      NodeFs.closeSync(logFd);
      resume(Effect.fail(new StackCommandError({ argv, cause })));
      return;
    }
    // The child holds its own copy of the descriptor from here on.
    NodeFs.closeSync(logFd);
    child.unref();
    let exited = false;
    child.once("exit", () => {
      exited = true;
    });
    child.once("error", (cause) => {
      resume(Effect.fail(new StackCommandError({ argv, cause })));
    });
    child.once("spawn", () => {
      const pid = child.pid;
      if (pid === undefined) {
        resume(Effect.fail(new StackCommandError({ argv, cause: "spawned without a pid" })));
        return;
      }
      resume(
        Effect.succeed({
          pid,
          isRunning: Effect.sync(() => !exited && signal(pid, 0)),
          stop: (grace) => stopGroup(pid, grace),
        }),
      );
    });
  });
