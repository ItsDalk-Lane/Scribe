import type { App } from "obsidian";
import { buildAgentModePicker } from "./agentModePickerHelpers";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendState, ModeApplySpec, ScribeMode } from "@/agentMode/session/types";
import { ConfirmModal } from "@/components/modals/ConfirmModal";

jest.mock("obsidian", () => ({
  Notice: jest.fn(),
  Modal: class {},
  App: class {},
}));

jest.mock("@/agentMode/backends/registry", () => ({
  backendRegistry: {},
  listBackendDescriptors: () => [],
  getActiveBackendDescriptor: () => undefined,
}));

const mockConfirmCallbacks: Array<() => void> = [];
jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: jest.fn().mockImplementation((_app: unknown, onConfirm: () => void) => ({
    open: jest.fn(() => {
      mockConfirmCallbacks.push(onConfirm);
    }),
  })),
}));

function makeUIState(canSwitchMode: boolean | null): AgentChatUIState {
  return {
    canSwitchMode: () => canSwitchMode,
  } as unknown as AgentChatUIState;
}

function makeManager(opts: {
  backendId: string | null;
  state: BackendState | null;
  canSwitchMode?: boolean | null;
  applyMode?: jest.Mock;
}): AgentSessionManager {
  const session = opts.backendId
    ? ({
        backendId: opts.backendId,
        getState: () => opts.state,
      } as unknown as AgentSession)
    : null;
  return {
    getActiveSession: () => session,
    getActiveChatUIState: () => makeUIState(opts.canSwitchMode ?? null),
    applyMode: opts.applyMode ?? jest.fn().mockResolvedValue(undefined),
  } as unknown as AgentSessionManager;
}

function modeState(
  current: ScribeMode,
  apply: Partial<Record<ScribeMode, ModeApplySpec>>
): BackendState {
  return {
    model: null,
    mode: {
      current,
      options: [
        { value: "default", label: "Default" },
        { value: "plan", label: "Plan" },
        { value: "full", label: "Full" },
      ],
      apply,
    },
  };
}

describe("agentModePickerHelpers", () => {
  describe("buildAgentModePicker()", () => {
    beforeEach(() => {
      mockConfirmCallbacks.length = 0;
      jest.mocked(ConfirmModal).mockClear();
    });

    it("returns null when manager is null", () => {
      expect(buildAgentModePicker({ manager: null, app: null })).toBeNull();
    });

    it("returns null when there is no active backend", () => {
      expect(
        buildAgentModePicker({
          manager: makeManager({ backendId: null, state: null }),
          app: null,
        })
      ).toBeNull();
    });

    it("returns null when the active backend has no mode state", () => {
      expect(
        buildAgentModePicker({
          manager: makeManager({
            backendId: "codex",
            state: { model: null, mode: null },
          }),
          app: null,
        })
      ).toBeNull();
    });

    it("returns null while the active session is starting", () => {
      expect(
        buildAgentModePicker({
          manager: makeManager({ backendId: "codex", state: null }),
          app: null,
        })
      ).toBeNull();
    });

    it("disabled mirrors canSwitchMode() === false", () => {
      const picker = buildAgentModePicker({
        manager: makeManager({
          backendId: "codex",
          state: modeState("plan", { plan: { kind: "setMode", nativeId: "plan" } }),
          canSwitchMode: false,
        }),
        app: null,
      });
      expect(picker?.disabled).toBe(true);
    });

    it("disabled is false when canSwitchMode returns true or null", () => {
      const state = modeState("plan", { plan: { kind: "setMode", nativeId: "plan" } });
      expect(
        buildAgentModePicker({
          manager: makeManager({ backendId: "codex", state, canSwitchMode: true }),
          app: null,
        })?.disabled
      ).toBe(false);
      expect(
        buildAgentModePicker({
          manager: makeManager({ backendId: "codex", state, canSwitchMode: null }),
          app: null,
        })?.disabled
      ).toBe(false);
    });

    it("onChange dispatches manager.applyMode with the canonical mode and per-option spec", () => {
      const applyMode = jest.fn().mockResolvedValue(undefined);
      const spec = { kind: "setMode" as const, nativeId: "plan" };
      const picker = buildAgentModePicker({
        manager: makeManager({
          backendId: "codex",
          state: modeState("default", { plan: spec }),
          applyMode,
        }),
        app: null,
      });
      picker?.onChange("plan");
      expect(applyMode).toHaveBeenCalledWith("codex", "plan", spec);
    });

    it("onChange ignores selections without an apply spec", () => {
      const applyMode = jest.fn().mockResolvedValue(undefined);
      const picker = buildAgentModePicker({
        manager: makeManager({
          backendId: "codex",
          state: modeState("default", {}),
          applyMode,
        }),
        app: null,
      });
      picker?.onChange("plan");
      expect(applyMode).not.toHaveBeenCalled();
    });

    it("onChange into full opens the risk confirmation modal instead of applying directly (https://github.com/ItsDalk-Lane/Scribe/issues/38)", () => {
      const applyMode = jest.fn().mockResolvedValue(undefined);
      const spec = { kind: "setMode" as const, nativeId: "full" };
      const app = {} as App;
      const picker = buildAgentModePicker({
        manager: makeManager({
          backendId: "native",
          state: modeState("default", { full: spec }),
          applyMode,
        }),
        app,
      });
      picker?.onChange("full");
      expect(ConfirmModal).toHaveBeenCalledTimes(1);
      expect(applyMode).not.toHaveBeenCalled();
    });

    it("onChange into full applies the mode only after the confirmation is accepted (https://github.com/ItsDalk-Lane/Scribe/issues/38)", () => {
      const applyMode = jest.fn().mockResolvedValue(undefined);
      const spec = { kind: "setMode" as const, nativeId: "full" };
      const picker = buildAgentModePicker({
        manager: makeManager({
          backendId: "native",
          state: modeState("default", { full: spec }),
          applyMode,
        }),
        app: {} as App,
      });
      picker?.onChange("full");
      expect(mockConfirmCallbacks.length).toBe(1);
      mockConfirmCallbacks[0]();
      expect(applyMode).toHaveBeenCalledWith("native", "full", spec);
    });

    it("onChange into full leaves the mode unchanged when the confirmation is dismissed (https://github.com/ItsDalk-Lane/Scribe/issues/38)", () => {
      const applyMode = jest.fn().mockResolvedValue(undefined);
      const picker = buildAgentModePicker({
        manager: makeManager({
          backendId: "native",
          state: modeState("default", { full: { kind: "setMode", nativeId: "full" } }),
          applyMode,
        }),
        app: {} as App,
      });
      picker?.onChange("full");
      expect(mockConfirmCallbacks.length).toBe(1);
      expect(applyMode).not.toHaveBeenCalled();
    });

    it("onChange out of full applies immediately without confirmation (https://github.com/ItsDalk-Lane/Scribe/issues/38)", () => {
      const applyMode = jest.fn().mockResolvedValue(undefined);
      const spec = { kind: "setMode" as const, nativeId: "default" };
      const picker = buildAgentModePicker({
        manager: makeManager({
          backendId: "native",
          state: modeState("full", { default: spec }),
          applyMode,
        }),
        app: {} as App,
      });
      picker?.onChange("default");
      expect(ConfirmModal).not.toHaveBeenCalled();
      expect(applyMode).toHaveBeenCalledWith("native", "default", spec);
    });

    it("onChange into full without an app does not switch (https://github.com/ItsDalk-Lane/Scribe/issues/38)", () => {
      const applyMode = jest.fn().mockResolvedValue(undefined);
      const picker = buildAgentModePicker({
        manager: makeManager({
          backendId: "native",
          state: modeState("default", { full: { kind: "setMode", nativeId: "full" } }),
          applyMode,
        }),
        app: null,
      });
      picker?.onChange("full");
      expect(ConfirmModal).not.toHaveBeenCalled();
      expect(applyMode).not.toHaveBeenCalled();
    });
  });
});
