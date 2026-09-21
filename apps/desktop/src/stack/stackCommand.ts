import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { StackCommandError } from "./StackErrors.ts";

export interface StackCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const COMMAND_TIMEOUT = Duration.minutes(5);
const COMMAND_STOP_GRACE = Duration.seconds(5);

const decode = (chunks: ReadonlyArray<Uint8Array>): string =>
  Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");

/**
 * Run a short command to completion and capture its output. Commands are argv
 * arrays and never go through a shell. Both streams are drained concurrently,
 * so a chatty stderr cannot fill its pipe and stall the process.
 */
export const runStackCommand = (
  argv: ReadonlyArray<string>,
  options: { readonly cwd?: string; readonly env?: Readonly<Record<string, string>> } = {},
): Effect.Effect<
  StackCommandResult,
  StackCommandError,
  ChildProcessSpawner.ChildProcessSpawner
> => {
  const [executable, ...args] = argv;
  if (executable === undefined) {
    return Effect.fail(new StackCommandError({ argv, cause: "empty command" }));
  }
  return Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const handle = yield* spawner.spawn(
        ChildProcess.make(executable, args, {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          // A stale cmux shim left in NODE_OPTIONS breaks every node invocation.
          env: { ...options.env, NODE_OPTIONS: "" },
          extendEnv: true,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          killSignal: "SIGTERM",
          forceKillAfter: COMMAND_STOP_GRACE,
        }),
      );
      const [stdout, stderr] = yield* Effect.all(
        [Stream.runCollect(handle.stdout), Stream.runCollect(handle.stderr)],
        { concurrency: 2 },
      );
      const exitCode = yield* handle.exitCode;
      return { exitCode: Number(exitCode), stdout: decode(stdout), stderr: decode(stderr) };
    }),
  ).pipe(
    Effect.timeoutOption(COMMAND_TIMEOUT),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(`timed out after ${Duration.toSeconds(COMMAND_TIMEOUT)}s`),
        onSome: Effect.succeed,
      }),
    ),
    Effect.mapError((cause) => new StackCommandError({ argv, cause })),
  );
};
