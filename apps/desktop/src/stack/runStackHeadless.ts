import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as NodeOs from "node:os";

import { makeArcusStack } from "./ArcusStack.ts";
import { localManifest } from "./localManifest.ts";
import { decodeStackManifest } from "./StackManifest.ts";

/**
 * Run the stack supervisor without the desktop app, so it can be developed and
 * tested with no build and no window. From apps/desktop:
 *
 *   node src/stack/runStackHeadless.ts
 *
 * Ctrl+C stops every service, exactly as quitting the app does.
 */
const program = Effect.gen(function* () {
  const path = yield* Path.Path;
  const home = NodeOs.homedir();
  const stackDir = process.env.ARCUS_STACK_DIR ?? path.join(home, ".arcus-dev-stack", "stack");
  const manifest = yield* decodeStackManifest(localManifest);
  const stack = yield* makeArcusStack({
    manifest,
    paths: {
      src: process.env.ARCUS_SRC ?? path.join(home, "Documents", "testsigma"),
      bin: path.join(stackDir, "bin"),
      home,
    },
    logDir: path.join(stackDir, "logs"),
  });
  yield* Effect.addFinalizer(() => stack.stop);
  return yield* stack.run;
}).pipe(Effect.scoped);

NodeRuntime.runMain(
  program.pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici))),
);
