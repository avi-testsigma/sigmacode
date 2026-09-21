import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ThreadShell } from "../types";
import { resolveArcusThread } from "./singleThread";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const OTHER_ENVIRONMENT_ID = EnvironmentId.make("environment-remote");
const PROJECT_ID = ProjectId.make("project-arcus");
const PROJECT_REF = { environmentId: ENVIRONMENT_ID, projectId: PROJECT_ID };

function makeThread(input: {
  readonly id: string;
  readonly at: string;
  readonly environmentId?: EnvironmentId;
  readonly archivedAt?: string;
}): ThreadShell {
  return {
    id: ThreadId.make(input.id),
    environmentId: input.environmentId ?? ENVIRONMENT_ID,
    projectId: PROJECT_ID,
    archivedAt: input.archivedAt ?? null,
    createdAt: input.at,
    updatedAt: input.at,
    latestUserMessageAt: input.at,
  } as unknown as ThreadShell;
}

describe("resolveArcusThread", () => {
  it("returns null before the first thread exists", () => {
    expect(resolveArcusThread([], PROJECT_REF)).toBeNull();
  });

  it("reopens the most recent thread for the project", () => {
    const older = makeThread({ id: "older", at: "2026-09-20T10:00:00.000Z" });
    const newer = makeThread({ id: "newer", at: "2026-09-21T10:00:00.000Z" });
    expect(resolveArcusThread([older, newer], PROJECT_REF)?.id).toBe("newer");
  });

  it("never resurrects an archived thread", () => {
    const live = makeThread({ id: "live", at: "2026-09-20T10:00:00.000Z" });
    const archived = makeThread({
      id: "archived",
      at: "2026-09-21T10:00:00.000Z",
      archivedAt: "2026-09-21T11:00:00.000Z",
    });
    expect(resolveArcusThread([live, archived], PROJECT_REF)?.id).toBe("live");
  });

  it("ignores the same project id in another environment", () => {
    const here = makeThread({ id: "here", at: "2026-09-20T10:00:00.000Z" });
    const elsewhere = makeThread({
      id: "elsewhere",
      at: "2026-09-21T10:00:00.000Z",
      environmentId: OTHER_ENVIRONMENT_ID,
    });
    expect(resolveArcusThread([here, elsewhere], PROJECT_REF)?.id).toBe("here");
  });
});
