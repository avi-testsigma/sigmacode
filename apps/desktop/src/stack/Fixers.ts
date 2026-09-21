import * as Effect from "effect/Effect";

import { runStackCommand } from "./stackCommand.ts";
import { StackFixerError } from "./StackErrors.ts";
import type { StackFixer } from "./StackManifest.ts";

// LocalStack accepts any credentials; the CLI only refuses to run without some.
const LOCALSTACK_ENV = {
  AWS_ACCESS_KEY_ID: "test",
  AWS_SECRET_ACCESS_KEY: "test",
  AWS_REGION: "us-east-1",
};

/**
 * Re-assert SSM parameters that a LocalStack restart silently reverts. It
 * repoints existing values rather than creating the resources a stale value
 * names: creating the databases a reverted name points at would look like a
 * working stack with every row gone.
 */
const ssmAssert = (fixer: StackFixer) =>
  Effect.forEach(
    Object.entries(fixer.values),
    ([key, wanted]) =>
      Effect.gen(function* () {
        const name = `${fixer.prefix}/${key}`;
        const ssm = ["aws", "--endpoint-url", fixer.endpoint, "--region", "us-east-1", "ssm"];
        const current = yield* runStackCommand(
          [
            ...ssm,
            "get-parameter",
            "--name",
            name,
            "--query",
            "Parameter.Value",
            "--output",
            "text",
          ],
          { env: LOCALSTACK_ENV },
        );
        const found = current.exitCode === 0 ? current.stdout.trim() : null;
        if (found === wanted) {
          return;
        }
        const written = yield* runStackCommand(
          [
            ...ssm,
            "put-parameter",
            "--name",
            name,
            "--value",
            wanted,
            "--type",
            "String",
            "--overwrite",
          ],
          { env: LOCALSTACK_ENV },
        );
        if (written.exitCode !== 0) {
          return yield* new StackFixerError({
            fixer: fixer.fixer,
            target: name,
            output: written.stderr.trim(),
          });
        }
        yield* Effect.logWarning("arcus.stack.fixerRepaired", { name, was: found, now: wanted });
      }),
    { discard: true },
  );

/** Run one manifest fixer. The set is an allowlist in the app, never code from the manifest. */
export const runFixer = (fixer: StackFixer) => ssmAssert(fixer);
