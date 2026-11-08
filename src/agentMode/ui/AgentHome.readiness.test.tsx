import { NativeBackendDescriptor } from "@/agentMode/backends/native/descriptor";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import { AgentInputDraftStore } from "@/agentMode/session/AgentInputDraftStore";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import { AgentHome } from "@/agentMode/ui/AgentHome";
import type ScribePlugin from "@/main";
import { getModelKeyFromModel, getSettings, resetSettings, setSettings } from "@/settings/model";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";
import type { AgentModelPickerOverride } from "@/agentMode/ui/useAgentModelPicker";
import type { SubagentSessionSnapshot } from "@/agentMode/session/subagentTypes";

let mockModelPicker: AgentModelPickerOverride | null = null;
let mockSubagents: readonly SubagentSessionSnapshot[] = [];

jest.mock("@/agentMode/ui/AgentChatInput", () => ({
  AgentChatInput: ({ disabled, sendDisabled }: { disabled: boolean; sendDisabled: boolean }) => (
    <button type="button" disabled={disabled || sendDisabled}>
      Send
    </button>
  ),
}));
jest.mock("@/agentMode/ui/AgentChatMessages", () => ({ __esModule: true, default: () => null }));
jest.mock("@/agentMode/ui/AgentChatControls", () => ({
  AgentChatControls: ({
    tasksIndicator,
    onNewChat,
  }: {
    tasksIndicator?: React.ReactNode;
    onNewChat?: () => void;
  }) => (
    <>
      {tasksIndicator}
      <button type="button" onClick={onNewChat}>
        New chat
      </button>
    </>
  ),
}));
jest.mock("@/agentMode/ui/AgentContextMeter", () => ({ __esModule: true, default: () => null }));
jest.mock("@/agentMode/ui/AgentModeStatus", () => ({ AgentModeStatus: () => null }));
jest.mock("@/agentMode/ui/AgentProjectHeader", () => ({ AgentProjectHeader: () => null }));
jest.mock("@/agentMode/ui/GlobalRecentChatsSection", () => ({
  GlobalRecentChatsSection: () => null,
}));
jest.mock("@/agentMode/ui/AgentTabStrip", () => ({ AgentTabStrip: () => null }));
jest.mock("@/agentMode/ui/hooks/useAgentChatRuntimeState", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- substitutes the peripheral runtime hook
  useAgentChatRuntimeState: () => ({
    messages: [],
    isStarting: false,
    isTurnInFlight: false,
    hasPendingPlanPermission: false,
    currentPlan: null,
    currentTodoList: null,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    queuedPrompts: [],
    tasks: [],
    subagents: mockSubagents,
    isReplyRunning: false,
  }),
}));
jest.mock("@/agentMode/ui/hooks/useAgentHistoryControls", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- substitutes unrelated history loading
  useAgentHistoryControls: () => ({
    chatHistoryItems: [],
    chatHistorySettled: true,
    loadChatHistory: async () => undefined,
  }),
}));
jest.mock("@/agentMode/ui/useAgentModelPicker", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- substitutes unrelated picker rendering
  useAgentModelPicker: () => mockModelPicker,
}));
jest.mock("@/agentMode/ui/useAgentModePicker", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- substitutes unrelated permission controls
  useAgentModePicker: () => null,
}));
jest.mock("@/hooks/useChatFileDrop", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- substitutes unrelated file dropping
  useChatFileDrop: () => ({ isDragActive: false }),
}));
jest.mock("@/projects/state", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- substitutes unrelated project discovery
  useProjects: () => [],
  getCachedProjectRecordById: () => null,
}));
const mockFetchProjects = jest.fn(async () => []);
jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: {
    getInstance: () => ({
      getProjectUsageTimestampsManager: () => ({
        getRevision: () => 0,
        subscribe: () => () => {},
        getEffectiveLastUsedAt: () => 0,
      }),
      fetchProjects: mockFetchProjects,
    }),
  },
}));

describe("AgentHome", () => {
  describe("AgentHome()", () => {
    afterEach(() => {
      cleanup();
      resetSettings();
      mockModelPicker = null;
      mockSubagents = [];
    });

    it.each(["background command", "child agent"])(
      "keeps the prior chat's running %s available when starting a new chat https://github.com/ItsDalk-Lane/Scribe/issues/50",
      async (kind) => {
        const app = { workspace: { getActiveFile: () => null } } as unknown as App;
        const original = {
          internalId: "chat-old",
          backendId: "native",
          projectId: GLOBAL_SCOPE,
          cwd: "/vault",
          hasUserVisibleMessages: () => true,
          task: { kind, status: "running" },
        };
        const replacement = { ...original, internalId: "chat-new", task: undefined };
        let active = original as typeof original | typeof replacement;
        const open = [original];
        const noIds = new Set<string>();
        const manager = {
          drafts: new AgentInputDraftStore(app, () => true),
          subscribe: () => () => {},
          getStartingBackendId: () => null,
          getIsStarting: () => false,
          getActiveSession: () => active,
          getSession: () => original,
          getActiveProjectId: () => GLOBAL_SCOPE,
          getSessionSourcePath: () => null,
          getOpenChatIds: () => noIds,
          getRunningChatIds: () => noIds,
          getAttentionChatIds: () => noIds,
          createSession: jest.fn(async () => {
            active = replacement;
            return replacement;
          }),
          detachSessionFromTab: jest.fn(),
          replaceSessionInPlace: jest.fn(async () => {
            original.task.status = "stopped";
            open.pop();
            active = replacement;
            return replacement;
          }),
        } as unknown as AgentSessionManager;
        const backend = {
          acceptsMidTurnMessages: () => false,
          canStopTasks: () => false,
        } as unknown as AgentChatBackend;
        render(
          <AgentHome
            backend={backend}
            sessionId="chat-old"
            chatInputId="chat-old"
            manager={manager}
            plugin={{ app } as ScribePlugin}
            updateUserMessageHistory={() => undefined}
          />
        );

        fireEvent.click(screen.getByRole("button", { name: "New chat" }));

        await waitFor(() => expect(manager.detachSessionFromTab).toHaveBeenCalledWith("chat-old"));
        expect(active).toBe(replacement);
        expect(open).toContain(original);
        expect(original.task.status).toBe("running");
      }
    );

    it("does not show the previous chat's delayed child-list failure after switching to another chat https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
      resetSettings();
      const app = { workspace: { getActiveFile: () => null } } as unknown as App;
      const session = {
        internalId: "chat-a",
        backendId: "native",
        cwd: "/vault",
        hasUserVisibleMessages: () => true,
      };
      const noIds = new Set<string>();
      const manager = {
        drafts: new AgentInputDraftStore(app, () => true),
        subscribe: () => () => {},
        getStartingBackendId: () => null,
        getActiveSession: () => session,
        getSession: () => session,
        getActiveProjectId: () => GLOBAL_SCOPE,
        getSessionSourcePath: () => null,
        getOpenChatIds: () => noIds,
        getRunningChatIds: () => noIds,
        getAttentionChatIds: () => noIds,
      } as unknown as AgentSessionManager;
      const child: SubagentSessionSnapshot = {
        id: "child-a",
        parentSessionId: "chat-a",
        modelId: "model",
        name: "聊天甲的整理",
        cwd: "/vault",
        retention: "retained",
        createdAt: 1,
        updatedAt: 1,
        runs: [],
        messages: [],
      };
      mockSubagents = [child];
      let fail!: (error: Error) => void;
      const pending = new Promise<void>((_resolve, reject) => {
        fail = reject;
      });
      const refreshA = jest.fn(() => pending);
      const refreshB = jest.fn(async () => undefined);
      const backend = (refresh: () => Promise<void>) =>
        ({
          acceptsMidTurnMessages: () => false,
          canStopTasks: () => false,
          getSubagentSessions: () => mockSubagents,
          sendSubagentMessage: async () => ({ subagentId: "child-a", status: "enqueued" }),
          stopSubagent: async () => undefined,
          setSubagentArchived: async () => undefined,
          deleteSubagentSession: async () => undefined,
          refreshSubagentSessions: refresh,
        }) as unknown as AgentChatBackend;
      const tree = (id: string, currentBackend: AgentChatBackend) => (
        <AgentHome
          backend={currentBackend}
          sessionId={id}
          chatInputId={id}
          manager={manager}
          plugin={{ app } as ScribePlugin}
          updateUserMessageHistory={() => undefined}
        />
      );
      const view = render(tree("chat-a", backend(refreshA)));
      fireEvent.click(screen.getByRole("button", { name: "Subagents (1)" }));
      fireEvent.click(screen.getByRole("button", { name: "Refresh child sessions" }));
      mockSubagents = [
        { ...child, id: "child-b", parentSessionId: "chat-b", name: "聊天乙的整理" },
      ];
      session.internalId = "chat-b";
      view.rerender(tree("chat-b", backend(refreshB)));
      await act(async () => {
        fail(new Error("聊天甲刷新失败"));
        await pending.catch(() => undefined);
      });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("button", { name: "Subagents (1)" })).toBeTruthy();
      expect(refreshB).not.toHaveBeenCalled();
    });

    it("refreshes projects when the list opens, is clicked again, and is reopened", async () => {
      resetSettings();
      setSettings({
        homeShelfTabs: { "scribe:home-shelf-tab:v1": "projects" },
        agentMode: { ...getSettings().agentMode, welcomeDismissed: true },
      });
      mockFetchProjects.mockClear();
      const app = { workspace: { getActiveFile: () => null } } as unknown as App;
      const session = {
        internalId: "chat",
        backendId: "native",
        cwd: "/vault",
        hasUserVisibleMessages: () => false,
      };
      const noIds = new Set<string>();
      const manager = {
        drafts: new AgentInputDraftStore(app, () => true),
        subscribe: () => () => {},
        getStartingBackendId: () => null,
        getActiveSession: () => session,
        getSession: () => session,
        getActiveProjectId: () => GLOBAL_SCOPE,
        getSessionSourcePath: () => null,
        getOpenChatIds: () => noIds,
        getRunningChatIds: () => noIds,
        getAttentionChatIds: () => noIds,
      } as unknown as AgentSessionManager;
      const backend = {
        acceptsMidTurnMessages: () => false,
        canStopTasks: () => false,
      } as unknown as AgentChatBackend;
      const tree = (
        <AgentHome
          backend={backend}
          sessionId="chat"
          chatInputId="input"
          manager={manager}
          plugin={{ app } as ScribePlugin}
          updateUserMessageHistory={() => undefined}
        />
      );
      const view = render(tree);
      await waitFor(() => expect(mockFetchProjects).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole("tab", { name: /Projects/ }));
      await waitFor(() => expect(mockFetchProjects).toHaveBeenCalledTimes(2));
      fireEvent.click(screen.getByRole("tab", { name: /Recent chats/ }));
      fireEvent.click(screen.getByRole("tab", { name: /Projects/ }));
      await waitFor(() => expect(mockFetchProjects).toHaveBeenCalledTimes(3));
      view.unmount();
      render(tree);
      await waitFor(() => expect(mockFetchProjects).toHaveBeenCalledTimes(4));
    });

    it("ignores obsolete enable switches and preserves the draft when configured models or the selected model are unavailable https://github.com/ItsDalk-Lane/Scribe/issues/31", () => {
      resetSettings();
      setSettings({
        providers: {
          local: {
            providerId: "local",
            displayName: "Local model service",
            providerType: "openai-compatible",
            origin: { kind: "byok" },
            baseUrl: "http://localhost:1234/v1",
            requiresApiKey: false,
            addedAt: 1,
          },
        },
        configuredModels: [
          {
            configuredModelId: "one",
            providerId: "local",
            info: { id: "one", displayName: "One" },
            configuredAt: 1,
          },
        ],
        backends: { native: { enabledModels: ["one"] } },
      });
      const app = { workspace: { getActiveFile: () => null } } as unknown as App;
      const drafts = new AgentInputDraftStore(app, () => true);
      drafts.update("input", (draft) => ({ ...draft, input: "A draft to keep" }));
      const session = {
        internalId: "chat",
        backendId: "native",
        cwd: "/vault",
        hasUserVisibleMessages: () => true,
      };
      const noIds = new Set<string>();
      const manager = {
        drafts,
        subscribe: () => () => {},
        getStartingBackendId: () => null,
        getActiveSession: () => session,
        getSession: () => session,
        getActiveProjectId: () => GLOBAL_SCOPE,
        getSessionSourcePath: () => null,
        getOpenChatIds: () => noIds,
        getRunningChatIds: () => noIds,
        getAttentionChatIds: () => noIds,
      } as unknown as AgentSessionManager;
      const backend = {
        acceptsMidTurnMessages: () => false,
        canStopTasks: () => false,
      } as unknown as AgentChatBackend;

      const tree = () => (
        <AgentHome
          backend={backend}
          sessionId="chat"
          chatInputId="input"
          manager={manager}
          plugin={{ app } as ScribePlugin}
          updateUserMessageHistory={() => undefined}
        />
      );
      const view = render(tree());
      const send = screen.getByRole("button", { name: "Send" });
      expect(send.hasAttribute("disabled")).toBe(false);

      act(() => setSettings({ backends: { native: { enabledModels: [] } } }));

      expect(NativeBackendDescriptor.getInstallState(getSettings()).kind).toBe("ready");
      expect(send.hasAttribute("disabled")).toBe(false);
      const configured = getSettings().configuredModels;
      act(() => setSettings({ configuredModels: [] }));
      expect(NativeBackendDescriptor.getInstallState(getSettings()).kind).toBe("error");
      expect(send.hasAttribute("disabled")).toBe(true);
      expect(drafts.get("input")?.input).toBe("A draft to keep");

      act(() => setSettings({ configuredModels: configured }));

      expect(NativeBackendDescriptor.getInstallState(getSettings()).kind).toBe("ready");
      expect(send.hasAttribute("disabled")).toBe(false);
      expect(drafts.get("input")?.input).toBe("A draft to keep");

      const unavailable = {
        name: "missing-key-model",
        provider: "agent",
        enabled: true,
        _disabledReason: "API key not set",
      };
      const usable = { name: "one", provider: "agent", enabled: true };
      mockModelPicker = {
        models: [unavailable, usable],
        value: getModelKeyFromModel(unavailable),
        onChange: jest.fn(),
      };
      view.rerender(tree());
      expect(NativeBackendDescriptor.getInstallState(getSettings()).kind).toBe("ready");
      expect(send.hasAttribute("disabled")).toBe(true);
      expect(drafts.get("input")?.input).toBe("A draft to keep");

      mockModelPicker = { ...mockModelPicker, value: getModelKeyFromModel(usable) };
      view.rerender(tree());
      expect(send.hasAttribute("disabled")).toBe(false);

      mockModelPicker = { ...mockModelPicker, value: "" };
      view.rerender(tree());
      expect(send.hasAttribute("disabled")).toBe(true);
      expect(drafts.get("input")?.input).toBe("A draft to keep");
    });
  });
});
