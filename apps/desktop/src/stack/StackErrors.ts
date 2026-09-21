import * as Schema from "effect/Schema";

export class StackCommandError extends Schema.TaggedError<StackCommandError>()(
  "StackCommandError",
  { argv: Schema.Array(Schema.String), cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not run ${this.argv.join(" ")}.`;
  }
}

export class StackContainersMissingError extends Schema.TaggedError<StackContainersMissingError>()(
  "StackContainersMissingError",
  { missing: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `These containers do not exist yet: ${this.missing.join(", ")}.`;
  }
}

export class StackContainerStartError extends Schema.TaggedError<StackContainerStartError>()(
  "StackContainerStartError",
  { name: Schema.String, output: Schema.String },
) {
  override get message(): string {
    return `Container ${this.name} would not start: ${this.output}`;
  }
}

export class StackDockerUnavailableError extends Schema.TaggedError<StackDockerUnavailableError>()(
  "StackDockerUnavailableError",
  { output: Schema.String },
) {
  override get message(): string {
    return `Docker is not responding: ${this.output}`;
  }
}

export class StackFixerError extends Schema.TaggedError<StackFixerError>()("StackFixerError", {
  fixer: Schema.String,
  target: Schema.String,
  output: Schema.String,
}) {
  override get message(): string {
    return `The ${this.fixer} repair could not update ${this.target}: ${this.output}`;
  }
}

export class StackBuildError extends Schema.TaggedError<StackBuildError>()("StackBuildError", {
  service: Schema.String,
  output: Schema.String,
}) {
  override get message(): string {
    return `${this.service} did not build: ${this.output}`;
  }
}

export class StackServiceUnhealthyError extends Schema.TaggedError<StackServiceUnhealthyError>()(
  "StackServiceUnhealthyError",
  { service: Schema.String, url: Schema.String, timeoutSec: Schema.Number, cause: Schema.Defect() },
) {
  override get message(): string {
    return `${this.service} did not answer ${this.url} within ${this.timeoutSec}s.`;
  }
}
