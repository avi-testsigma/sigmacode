import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The stores read the switch at load, so it has to be on before they are imported.
vi.mock("../branding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../branding")>()),
  ARCUS_MODE: true,
}));

import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";

const REF = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-arcus"));

describe("Arcus mode right panel", () => {
  beforeEach(() => {
    useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  });

  it.each(["diff", "files", "pull-requests", "agents", "device"] as const)(
    "refuses to open the %s pane",
    (kind) => {
      useRightPanelStore.getState().open(REF, kind);
      const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, REF);
      expect(state.surfaces).toEqual([]);
      expect(state.isOpen).toBe(false);
    },
  );

  it("refuses to open a terminal pane", () => {
    useRightPanelStore.getState().openTerminal(REF, "terminal-1");
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, REF);
    expect(state.surfaces).toEqual([]);
    expect(state.isOpen).toBe(false);
  });

  it("still opens the live preview", () => {
    useRightPanelStore.getState().open(REF, "preview");
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, REF);
    expect(state.surfaces.map((surface) => surface.kind)).toEqual(["preview"]);
    expect(state.isOpen).toBe(true);
  });
});

describe("Arcus mode terminal drawer", () => {
  beforeEach(() => {
    useTerminalUiStateStore.persist.clearStorage();
    useTerminalUiStateStore.setState({
      terminalUiStateByThreadKey: {},
      suppressedTerminalIdsByThreadKey: {},
    });
  });

  it("never opens, even when asked to", () => {
    useTerminalUiStateStore.getState().setTerminalOpen(REF, true);
    const state = selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
      REF,
    );
    expect(state.terminalOpen).toBe(false);
  });
});
