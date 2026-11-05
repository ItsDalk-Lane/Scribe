import React from "react";
import type ScribePlugin from "@/main";
import { ReportIssueFlow, type PreparedReport } from "@/agentMode/ui/ReportIssueFlow";
import { setInterfaceLocale } from "@/lib/i18n";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { createAssistantMessage, type ProviderChatModel } from "@/LLMProviders/piChatModel";
import { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import { type AgentSession } from "@/agentMode/session/AgentSession";
import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { TooltipProvider } from "@/components/ui/tooltip";
import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import { NativeBackendDescriptor } from "@/agentMode/backends/native/descriptor";
import * as nativeModels from "@/agentMode/backends/native/nativeModels";
import * as nativePrompt from "@/agentMode/backends/native/nativeSystemPrompt";
import { useApp } from "@/context";
import { AdvancedSettings } from "@/settings/v2/components/AdvancedSettings";
import { DEFAULT_SETTINGS } from "@/constants";
import { getSettings, settingsAtom, settingsStore } from "@/settings/model";
import { KeychainService } from "@/services/keychainService";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { FileSystemAdapter, type App } from "obsidian";

jest.mock("@/context", () => ({
  ...jest.requireActual<object>("@/context"),
  useApp: jest.fn(),
}));
function mockReadPlugin() {
  return mockPlugin;
}
jest.mock("@/contexts/PluginContext", () => ({ usePlugin: mockReadPlugin }));
jest.mock("@/agentMode/sdk/NativeSessionStorage", () => ({
  NodeNativeSessionStorage: class {
    private readonly records = new Map<string, unknown>();
    async save(record: { sessionId: string }) {
      this.records.set(record.sessionId, structuredClone(record));
    }
    async load(id: string) {
      return this.records.get(id) ?? null;
    }
    async list() {
      return [...this.records.values()];
    }
    async remove(id: string) {
      this.records.delete(id);
    }
  },
}));
function mockReadScrolling() {
  return {
    scrollContainerCallbackRef: jest.fn(),
    contentCallbackRef: jest.fn(),
    onScroll: jest.fn(),
    isScrollPaused: false,
    scrollToEnd: jest.fn(),
    getMessageKey: (message: { id: string }) => message.id,
  };
}
jest.mock("@/hooks/useChatScrolling", () => ({ useChatScrolling: mockReadScrolling }));
jest.mock("@/components/chat-components/ChatSingleMessage", () => ({
  __esModule: true,
  default: ({ message }: { message: { message: string } }) => <div>{message.message}</div>,
}));
jest.mock("@/agentMode/ui/AgentTrailView", () => ({ AgentTrail: () => <div>Fixture reply</div> }));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

let mockPlugin: ScribePlugin;
let modelFailure = false;
const fixtureModel = {
  id: "fixture-model",
  name: "Fixture",
  api: "openai-completions" as const,
  provider: "fixture",
  baseUrl: "http://invalid.test",
  reasoning: false,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10000,
  maxTokens: 1000,
};

function streamFixture(withTool: boolean) {
  const stream = createAssistantMessageEventStream();
  const message = createAssistantMessage(fixtureModel);
  if (modelFailure) {
    message.content = [];
    message.stopReason = "error";
    message.errorMessage = "Synthetic model failure";
    stream.push({ type: "start", partial: message });
    stream.push({ type: "error", reason: "error", error: message });
    return stream;
  }
  message.content = withTool
    ? [
        {
          type: "toolCall",
          id: "feedback-call",
          name: "send_feedback",
          arguments: {
            title: "Fixture failure",
            what_happened: "Synthetic issue",
            repro: "Synthetic steps",
          },
        },
      ]
    : [{ type: "text", text: "Fixture response" }];
  message.stopReason = withTool ? "toolUse" : "stop";
  stream.push({ type: "start", partial: message });
  stream.push({ type: "done", reason: message.stopReason, message });
  return stream;
}

describe("feedbackPreference", () => {
  describe("registeredFeedbackTool()", () => {
    let manager: AgentSessionManager;
    let observedMessages: unknown[][];
    beforeAll(() => {
      if (!("PointerEvent" in window))
        (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
      Element.prototype.hasPointerCapture = () => false;
      Element.prototype.releasePointerCapture = () => {};
      Element.prototype.scrollIntoView = () => {};
    });
    beforeEach(() => {
      setInterfaceLocale("en");
      modelFailure = false;
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        providers: {
          fixture: {
            providerId: "fixture",
            providerType: "openai-compatible",
            displayName: "Fixture",
            origin: { kind: "byok" },
            requiresApiKey: false,
            addedAt: 1,
          },
        },
        configuredModels: [
          {
            configuredModelId: "fixture-model",
            providerId: "fixture",
            info: { id: "fixture-model", displayName: "Fixture" },
            configuredAt: 1,
          },
        ],
        backends: {
          chat: { enabledModels: ["fixture-model"] },
          native: { enabledModels: ["fixture-model"] },
        },
        agentMode: { ...DEFAULT_SETTINGS.agentMode, notificationSound: false },
      });
      const adapter = new (FileSystemAdapter as unknown as new (path: string) => FileSystemAdapter)(
        "/synthetic-vault"
      );
      const events = { on: jest.fn(() => ({})), offref: jest.fn() };
      const app = {
        vault: {
          adapter,
          configDir: ".synthetic-config",
          ...events,
          getAbstractFileByPath: () => null,
          getFiles: () => [],
        },
        metadataCache: events,
        workspace: {
          getMostRecentLeaf: () => null,
          getLeavesOfType: () => [],
          getActiveFile: () => null,
        },
      } as unknown as App;
      mockPlugin = {
        app,
        manifest: { version: "fixture" },
        agentSessionManager: undefined,
      } as unknown as ScribePlugin;
      const preloader = {
        getCachedModelCatalog: () => null,
        getEffortCatalog: () => null,
        preload: async () => undefined,
        refresh: () => null,
        subscribe: () => () => {},
        shutdown: () => {},
        clearCached: () => {},
        stop: async () => {},
        takeWarm: () => null,
        getWarmProcs: () => [],
      };
      manager = new AgentSessionManager(app, mockPlugin, {
        permissionPrompter: async () => ({ outcome: { outcome: "cancelled" } }),
        resolveDescriptor: (id) => (id === "native" ? NativeBackendDescriptor : undefined),
        modelPreloader: preloader as never,
      });
      mockPlugin.agentSessionManager = manager;
      jest.mocked(useApp).mockReturnValue(app);
      KeychainService.resetInstance();
      KeychainService.getInstance(app);
      jest.spyOn(nativePrompt, "buildNativeSystemPrompt").mockResolvedValue("Fixture prompt");
      let requests = 0;
      observedMessages = [];
      const provider: ProviderChatModel = {
        model: fixtureModel,
        stream: () => streamFixture(++requests % 2 === 1),
        agentStream: (context) => {
          observedMessages.push(structuredClone(context.messages));
          return streamFixture(++requests % 2 === 1);
        },
      };
      jest.spyOn(nativeModels, "createNativeModel").mockResolvedValue(provider);
    });
    afterEach(async () => {
      await manager.shutdown();
      KeychainService.resetInstance();
      jest.restoreAllMocks();
    });

    function setToggleThroughSettings(enabled: boolean) {
      const settingsView = render(<AdvancedSettings section="debug" />);
      const row = screen.getByText("Offer feedback reports in Agent Chat").parentElement
        ?.parentElement;
      const toggle = row?.querySelector('[role="switch"]');
      if (!toggle) throw new Error("Feedback setting switch not found");
      if ((toggle.getAttribute("aria-checked") === "true") !== enabled) fireEvent.click(toggle);
      expect(getSettings().agentMode.offerFeedbackCards).toBe(enabled);
      settingsView.unmount();
    }

    function renderSession(session: AgentSession) {
      return render(
        <AgentChatMessages
          messages={[...session.store.getDisplayMessages()]}
          plugin={mockPlugin}
          currentPlan={null}
          pendingToolPermissions={[]}
          pendingAskUserQuestions={[]}
          chatBackend={new AgentChatUIState(session)}
          isLoading={false}
          feedbackOffer={session.getFeedbackOffer()}
        />
      );
    }

    async function sendFixture() {
      const session = await manager.createSession("native");
      await session.ready;
      await session.sendPrompt("Synthetic request").turn;
      return session;
    }

    it("does not show a card when the user disables feedback before a model invokes the registered feedback tool", async () => {
      setToggleThroughSettings(false);
      const session = await sendFixture();
      renderSession(session);
      expect(screen.queryByTestId("agent-feedback-card")).toBeNull();
      expect(session.getFeedbackOffer()).toBeNull();
      expect(observedMessages[1]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "toolResult",
            toolName: "send_feedback",
            content: [expect.objectContaining({ text: "Feedback draft: turned_off." })],
            details: { status: "turned_off" },
          }),
        ])
      );
    });

    it("also prevents automatic failure cards when the real switch is off", async () => {
      setToggleThroughSettings(false);
      modelFailure = true;
      const session = await manager.createSession("native");
      await session.ready;
      await expect(session.sendPrompt("Synthetic failing request").turn).rejects.toThrow(
        "Synthetic model failure"
      );
      renderSession(session);
      expect(session.getFeedbackOffer()).toBeNull();
      expect(screen.queryByTestId("agent-feedback-card")).toBeNull();
    });

    it("shows a card for a valid model request when the default setting is enabled", async () => {
      expect(getSettings().agentMode.offerFeedbackCards).toBe(true);
      const session = await sendFixture();
      renderSession(session);
      expect(screen.getByTestId("agent-feedback-card").textContent).toContain("Fixture failure");
      expect(session.getFeedbackOffer()?.status).toBe("open");
      expect(observedMessages[1]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "toolResult",
            toolName: "send_feedback",
            content: [expect.objectContaining({ text: "Feedback draft: shown." })],
            details: { status: "shown" },
          }),
        ])
      );
    });

    it("keeps an existing card available for review but truthfully rejects new tool offers while the switch is off", async () => {
      const session = await sendFixture();
      const first = session.getFeedbackOffer();
      expect(first?.status).toBe("open");
      setToggleThroughSettings(false);
      await session.sendPrompt("Another synthetic request").turn;
      expect(session.getFeedbackOffer()).toBe(first);
      expect(observedMessages[3]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "toolResult",
            toolName: "send_feedback",
            content: [expect.objectContaining({ text: "Feedback draft: turned_off." })],
            details: { status: "turned_off" },
          }),
        ])
      );
      const view = renderSession(session);
      expect(screen.getByTestId("agent-feedback-card")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(session.getFeedbackOffer()?.status).toBe("dismissed");
      view.rerender(
        <AgentChatMessages
          messages={[...session.store.getDisplayMessages()]}
          plugin={mockPlugin}
          currentPlan={null}
          pendingToolPermissions={[]}
          pendingAskUserQuestions={[]}
          chatBackend={new AgentChatUIState(session)}
          isLoading={false}
          feedbackOffer={session.getFeedbackOffer()}
        />
      );
      expect(screen.queryByTestId("agent-feedback-card")).toBeNull();
      expect(getSettings().agentMode.offerFeedbackCards).toBe(false);
    });

    it("honours Don't offer again for a later chat while dismissing the current card", async () => {
      const firstSession = await sendFixture();
      const view = renderSession(firstSession);
      fireEvent.click(screen.getByRole("button", { name: "Don't offer again" }));
      expect(firstSession.getFeedbackOffer()?.status).toBe("dismissed");
      expect(getSettings().agentMode.offerFeedbackCards).toBe(false);
      view.unmount();
      await firstSession.sendPrompt("Another request in the same chat").turn;
      expect(observedMessages[3]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "toolResult",
            toolName: "send_feedback",
            content: [expect.objectContaining({ text: "Feedback draft: turned_off." })],
            details: { status: "turned_off" },
          }),
        ])
      );
      const secondSession = await sendFixture();
      renderSession(secondSession);
      expect(screen.queryByTestId("agent-feedback-card")).toBeNull();
    });

    it("can show feedback again after the user re-enables it", async () => {
      setToggleThroughSettings(false);
      const session = await sendFixture();
      expect(session.getFeedbackOffer()).toBeNull();
      setToggleThroughSettings(true);
      await session.sendPrompt("Another synthetic request").turn;
      renderSession(session);
      expect(screen.getByTestId("agent-feedback-card").textContent).toContain("Fixture failure");
    });

    it("keeps manual reporting available while off and never uploads before the user explicitly confirms", async () => {
      setToggleThroughSettings(false);
      const prepared: PreparedReport = {
        zipDir: "/synthetic-report",
        zipPath: "/synthetic-report/report.zip",
        zipName: "report.zip",
        uploadAttempt: { body: new ArrayBuffer(1), idempotencyKey: "synthetic-attempt" },
        issueDraft: { title: "Synthetic manual report", body: "Synthetic only" },
        manualIssueUrl: "https://example.test/issue",
        attachments: [],
      };
      const prepare = jest.fn().mockResolvedValue(prepared);
      const upload = jest.fn().mockResolvedValue({
        ok: true,
        reportId: "synthetic-id",
        issueUrl: "https://example.test/issue",
      });
      const onUploaded = jest.fn();
      const userOpenedReport = jest.fn(() =>
        render(
          <ReportIssueFlow
            sources={[]}
            prepare={prepare}
            upload={upload}
            discardReport={async () => {}}
            onCancel={() => {}}
            onUploaded={onUploaded}
            openIssuePage={() => {}}
            revealFile={() => {}}
          />
        )
      );
      render(
        <TooltipProvider>
          <AgentChatControls onNewChat={() => {}} onReportError={userOpenedReport} />
        </TooltipProvider>
      );
      fireEvent.pointerDown(screen.getByTitle("More actions"), { button: 0, ctrlKey: false });
      fireEvent.click(
        within(screen.getByRole("menu")).getByRole("menuitem", { name: "Report an issue" })
      );
      expect(userOpenedReport).toHaveBeenCalledTimes(1);
      expect(upload).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));
        await prepare.mock.results[0].value;
      });
      expect(screen.getByText("report.zip")).toBeTruthy();
      expect(upload).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Upload & open issue" }));
        await upload.mock.results[0].value;
      });
      expect(upload).toHaveBeenCalledTimes(1);
      expect(onUploaded).toHaveBeenCalledWith({
        reportId: "synthetic-id",
        issueUrl: "https://example.test/issue",
      });
    });
  });
});
