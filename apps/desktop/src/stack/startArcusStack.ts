import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeArcusStack } from "./ArcusStack.ts";
import { localManifest } from "./localManifest.ts";
import { decodeStackManifest } from "./StackManifest.ts";

/**
 * Bring the Arcus stack up with the app and tear it down with it. The stop is a
 * finalizer on the app's own scope, so a normal quit stops every service before
 * the app exits, while a force-quit leaves them for the next launch to adopt.
 * A stack that cannot start is logged, never allowed to take the app down.
 */
export const startArcusStack = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const manifest = yield* decodeStackManifest(localManifest);
  const configuredSrc = yield* Config.String("ARCUS_SRC").pipe(Config.option);
  const join = environment.path.join;
  const stackDir = join(environment.baseDir, "stack");
  const stack = yield* makeArcusStack({
    manifest,
    paths: {
      src: Option.getOrElse(configuredSrc, () =>
        join(environment.homeDirectory, "Documents", "testsigma"),
      ),
      bin: join(stackDir, "bin"),
      home: environment.homeDirectory,
    },
    logDir: join(stackDir, "logs"),
  });
  yield* Effect.addFinalizer(() => stack.stop);
  yield* Effect.forkScoped(stack.run);
  yield* Effect.logInfo("arcus.stack.supervising", {
    services: manifest.services.length,
    stackDir,
  });
}).pipe(
  Effect.catch((error) => Effect.logError("arcus.stack.unavailable", { reason: String(error) })),
);
