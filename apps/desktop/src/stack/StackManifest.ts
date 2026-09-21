import * as Schema from "effect/Schema";

const Argv = Schema.Array(Schema.String).check(Schema.isMinLength(1));
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));

const SsmAssertFixer = Schema.Struct({
  fixer: Schema.Literal("ssmAssert"),
  endpoint: Schema.String,
  prefix: Schema.String,
  values: Schema.Record(Schema.String, Schema.String),
});

/** A repair the supervisor runs before a service starts. Named, never code from the manifest. */
export const StackFixer = SsmAssertFixer;
export type StackFixer = typeof StackFixer.Type;

export const StackService = Schema.Struct({
  id: Schema.String,
  cwd: Schema.String,
  run: Argv,
  env: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  port: PositiveInt,
  health: Schema.Struct({ url: Schema.String, timeoutSec: PositiveInt }),
  build: Schema.optionalKey(Schema.Struct({ run: Argv, output: Schema.String })),
  preStart: Schema.optionalKey(Schema.Array(StackFixer)),
});
export type StackService = typeof StackService.Type;

/**
 * Everything the supervisor needs to bring the stack up. Services start in
 * array order, each waiting for the previous one's health check, so order is
 * the dependency graph. Commands are argv arrays and never go through a shell.
 */
export const StackManifest = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  containers: Schema.Array(Schema.Struct({ name: Schema.String })),
  services: Schema.Array(StackService).check(Schema.isMinLength(1)),
});
export type StackManifest = typeof StackManifest.Type;

export const decodeStackManifest = Schema.decodeUnknownEffect(StackManifest);

export interface StackPaths {
  /** Parent directory holding the repo checkouts. */
  readonly src: string;
  /** Where built binaries go. */
  readonly bin: string;
  readonly home: string;
}

/**
 * Expand `{src}`, `{bin}` and `{home}` in a manifest value. An unknown
 * placeholder is left alone, so a typo surfaces in the command that uses it
 * rather than silently becoming an empty path.
 */
export function expandPlaceholders(value: string, paths: StackPaths): string {
  return value.replace(/\{(src|bin|home)\}/g, (_match, key: keyof StackPaths) => paths[key]);
}
