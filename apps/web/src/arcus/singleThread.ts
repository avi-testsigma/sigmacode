import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useMemo } from "react";

import { ARCUS_MODE } from "../branding";
import { getLatestThreadForProject } from "../lib/threadSort";
import { useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import type { ThreadShell } from "../types";

type NewThreadHandler = (
  projectRef: ScopedProjectRef,
  options?: { readonly replace?: boolean },
) => Promise<unknown>;

/**
 * The thread Arcus Dev Stack keeps returning to for a project, or null before
 * the first one exists. Scoped to the project's environment, since project ids
 * are only unique within one.
 */
export function resolveArcusThread(
  threads: ReadonlyArray<ThreadShell>,
  projectRef: ScopedProjectRef,
): ThreadShell | null {
  const inEnvironment = threads.filter(
    (thread) => thread.environmentId === projectRef.environmentId,
  );
  return getLatestThreadForProject(inEnvironment, projectRef.projectId, "updated_at");
}

function useReopenExistingThread<H extends NewThreadHandler>(handleNewThread: H): H {
  const router = useRouter();
  const threads = useThreadShells();
  return useMemo(() => {
    const reopenExisting = async (
      projectRef: ScopedProjectRef,
      options?: { readonly replace?: boolean },
    ) => {
      const thread = resolveArcusThread(threads, projectRef);
      if (thread === null) {
        return handleNewThread(projectRef, options);
      }
      await router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
        replace: options?.replace ?? false,
      });
      return undefined;
    };
    return reopenExisting as H;
  }, [handleNewThread, router, threads]);
}

function passThroughHandler<H extends NewThreadHandler>(handleNewThread: H): H {
  return handleNewThread;
}

/**
 * Arcus Dev Stack is a single chat, so every entry point that would start a
 * thread reopens the existing one instead; only the very first request creates
 * it. Chosen once at load because the mode never changes at runtime, which
 * keeps upstream builds free of any extra hook calls.
 */
export const useArcusSingleThread = ARCUS_MODE ? useReopenExistingThread : passThroughHandler;
