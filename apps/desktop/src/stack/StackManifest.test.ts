import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { localManifest } from "./localManifest.ts";
import { decodeStackManifest, expandPlaceholders } from "./StackManifest.ts";

const service = {
  id: "svc",
  cwd: "/repo",
  run: ["node", "index.js"],
  port: 8000,
  health: { url: "http://127.0.0.1:8000/health", timeoutSec: 10 },
};

const rejection = (input: unknown) =>
  decodeStackManifest(input).pipe(
    Effect.flip,
    Effect.map((error) => String(error)),
  );

describe("StackManifest", () => {
  it.effect("decodes the bundled local manifest in start order", () =>
    Effect.gen(function* () {
      const manifest = yield* decodeStackManifest(localManifest);
      assert.deepStrictEqual(
        manifest.services.map((entry) => entry.id),
        ["identity", "identity-ui", "sigma-svc", "chitragupt", "bt-agent", "guardians"],
      );
    }),
  );

  it.effect("rejects a service with no command, naming the field", () =>
    Effect.gen(function* () {
      const message = yield* rejection({
        schemaVersion: 1,
        containers: [],
        services: [{ ...service, run: [] }],
      });
      assert.include(message, "run");
    }),
  );

  it.effect("rejects a manifest with no services", () =>
    Effect.gen(function* () {
      const message = yield* rejection({ schemaVersion: 1, containers: [], services: [] });
      assert.include(message, "services");
    }),
  );

  it.effect("rejects a schema version it does not understand", () =>
    Effect.gen(function* () {
      const message = yield* rejection({ schemaVersion: 2, containers: [], services: [service] });
      assert.include(message, "schemaVersion");
    }),
  );

  it("expands known placeholders and leaves unknown ones visible", () => {
    const paths = { src: "/src", bin: "/bin", home: "/home" };
    assert.strictEqual(expandPlaceholders("{src}/api/{bin}/x", paths), "/src/api//bin/x");
    assert.strictEqual(expandPlaceholders("{srcx}/y", paths), "{srcx}/y");
  });
});
