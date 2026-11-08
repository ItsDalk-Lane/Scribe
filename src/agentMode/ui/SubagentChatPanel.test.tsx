import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { SubagentSessionSnapshot } from "@/agentMode/session/subagentTypes";
import type { AgentChatMessage, SessionUsage } from "@/agentMode/session/types";
import { SubagentChatPanel } from "@/agentMode/ui/SubagentChatPanel";
import { useAgentChatRuntimeState } from "@/agentMode/ui/hooks/useAgentChatRuntimeState";
import { TooltipProvider } from "@/components/ui/tooltip";
import type ScribePlugin from "@/main";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

jest.mock("@/agentMode/backends/registry", () => ({ listBackendDescriptors: () => [] }));
jest.mock("@/agentMode/ui/agentModelPickerHelpers", () => ({
  buildAgentModelPicker: () => null,
}));
const mockMessages = jest.fn();
const mockInput = jest.fn();
jest.mock("@/agentMode/ui/AgentChatInput", () => ({
  AgentChatInput: (props: unknown) => {
    mockInput(props);
    return <div />;
  },
}));
jest.mock("@/agentMode/ui/AgentChatMessages", () => ({
  __esModule: true,
  default: (props: unknown) => {
    mockMessages(props);
    return <div />;
  },
}));
jest.mock("@/agentMode/ui/hooks/useAgentChatRuntimeState", () => ({
  useAgentChatRuntimeState: jest.fn(() => ({ messages: [], queuedPrompts: [] })),
}));
jest.mock("@/agentMode/ui/hooks/useAgentInputDrafts", () => ({
  useAgentInputDrafts: jest.fn(() => ({ loading: false })),
}));
jest.mock("@/agentMode/ui/useBackendDescriptor", () => ({
  useSessionBackendDescriptor: jest.fn(() => ({ skillsProjectDir: null })),
}));
jest.mock("@/context/ChatInputContext", () => ({
  ChatInputProvider: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock("@/settings/model", () => ({ useSettingsValue: jest.fn(() => ({})) }));

describe("SubagentChatPanel", () => {
  describe("SubagentChatPanel()", () => {
    it.each([false, true])(
      "streams a live child after waking or delivered steering (steering=%s) while its input remains available https://github.com/ItsDalk-Lane/Scribe/issues/52",
      (steering) => {
        jest
          .mocked(useAgentChatRuntimeState)
          .mockImplementation(
            jest.requireActual<typeof import("@/agentMode/ui/hooks/useAgentChatRuntimeState")>(
              "@/agentMode/ui/hooks/useAgentChatRuntimeState"
            ).useAgentChatRuntimeState
          );
        const listeners = new Set<() => void>();
        const snapshot: SubagentSessionSnapshot = {
          id: "child",
          parentSessionId: "parent",
          name: "Child",
          modelId: "glm",
          cwd: "/vault",
          retention: "retained",
          createdAt: 1000,
          updatedAt: 5000,
          runs: [
            {
              id: "wake",
              roundId: "first",
              toolCallId: "call",
              taskGenerationId: "g",
              status: "running",
              createdAt: 1000,
              startedAt: 1000,
              usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
            },
          ],
          messages: steering
            ? [
                {
                  id: "addition",
                  sequence: 2,
                  subagentId: "child",
                  runId: "wake",
                  roundId: "second",
                  taskGenerationId: "g",
                  direction: "to_child",
                  sender: "user",
                  kind: "instruction",
                  text: "补充核对",
                  state: "delivered",
                  acceptedAt: 4000,
                  deliveredAt: 5000,
                  deliverySeq: 15,
                },
              ]
            : [],
        };
        let thought = "第一行\n正在核对";
        const reply = (): AgentChatMessage => ({
          id: "reply",
          sender: "ai",
          message: "",
          isVisible: true,
          timestamp: null,
          parts: [
            ...(steering
              ? [{ kind: "text" as const, text: "Earlier answer", segmentSeq: 10 }]
              : []),
            { kind: "thought", text: thought, startedAtMs: 5200, segmentSeq: 20 },
          ],
        });
        const parent = {
          getSubagentSessions: () => [snapshot],
          getTaskMessages: () => [reply()],
          getPendingToolPermissions: () => [],
          getMessageUsageMetrics: (message: AgentChatMessage) =>
            message.parts?.some((part) => part.segmentSeq === 20)
              ? { partial: true, sources: [], roundStartedAtMs: 5000, hasActiveWork: true }
              : { partial: false, sources: [], roundStopReason: "end_turn", roundDurationMs: 2000 },
          subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          },
        } as unknown as AgentChatBackend;
        render(
          <TooltipProvider>
            <SubagentChatPanel
              app={{} as App}
              plugin={{} as ScribePlugin}
              manager={{} as AgentSessionManager}
              parentBackend={parent}
              subagentId="child"
              onBack={() => {}}
            />
          </TooltipProvider>
        );
        expect(mockMessages.mock.calls.at(-1)![0].isLoading).toBe(true);
        expect(mockInput.mock.calls.at(-1)![0]).toMatchObject({
          isLoading: false,
          isReplyRunning: true,
        });
        act(() => {
          thought += "新的流式内容";
          for (const listener of listeners) listener();
        });
        expect(mockMessages.mock.calls.at(-1)![0].messages.at(-1).parts[0].text).toBe(thought);
        expect(mockMessages.mock.calls.at(-1)![0].isLoading).toBe(true);
      }
    );

    it.each([false, true])(
      "shows the pending child's run or current delivery start (delivered input=%s) without restarting its old reply https://github.com/ItsDalk-Lane/Scribe/issues/52",
      (deliveredInput) => {
        jest.useFakeTimers();
        jest.setSystemTime(10000);
        jest
          .mocked(useAgentChatRuntimeState)
          .mockImplementation(
            jest.requireActual<typeof import("@/agentMode/ui/hooks/useAgentChatRuntimeState")>(
              "@/agentMode/ui/hooks/useAgentChatRuntimeState"
            ).useAgentChatRuntimeState
          );
        const snapshot: SubagentSessionSnapshot = {
          id: "child",
          parentSessionId: "parent",
          name: "Child",
          modelId: "glm",
          cwd: "/vault",
          retention: "retained",
          createdAt: 1,
          updatedAt: 5000,
          runs: [
            {
              id: "wake",
              roundId: "wake-round",
              toolCallId: "call",
              taskGenerationId: "g",
              status: "running",
              createdAt: 4000,
              startedAt: deliveredInput ? 1000 : 5000,
              usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
            },
          ],
          messages: deliveredInput
            ? [
                {
                  id: "addition",
                  sequence: 2,
                  subagentId: "child",
                  runId: "wake",
                  roundId: "next-round",
                  taskGenerationId: "g",
                  direction: "to_child",
                  sender: "user",
                  kind: "instruction",
                  text: "补充核对",
                  state: "delivered",
                  acceptedAt: 4000,
                  deliveredAt: 5000,
                  deliverySeq: 15,
                },
              ]
            : [],
        };
        const old: AgentChatMessage = {
          id: "old",
          sender: "ai",
          message: "Earlier answer",
          timestamp: null,
          isVisible: true,
          turnStopReason: "end_turn",
        };
        jest.mocked(useAgentChatRuntimeState).mockReturnValue({
          messages: [old],
          isReplyRunning: true,
          isTurnInFlight: false,
          queuedPrompts: [],
          isStarting: false,
          hasPendingPlanPermission: false,
          currentPlan: null,
          currentTodoList: null,
          pendingToolPermissions: [],
          pendingAskUserQuestions: [],
          tasks: [],
          subagents: [],
        });
        const parent = {
          getSubagentSessions: () => [snapshot],
          subscribe: () => () => {},
        } as unknown as AgentChatBackend;
        try {
          render(
            <TooltipProvider>
              <SubagentChatPanel
                app={{} as App}
                plugin={{} as ScribePlugin}
                manager={{} as AgentSessionManager}
                parentBackend={parent}
                subagentId="child"
                onBack={() => {}}
              />
            </TooltipProvider>
          );
          expect(screen.getByRole("status").textContent).toBe("Agent is working");
          expect(screen.getByText("5.0s")).toBeTruthy();
          expect(mockMessages.mock.calls.at(-1)![0].isLoading).toBe(false);
        } finally {
          jest.useRealTimers();
        }
      }
    );

    it("shows the child's cumulative tokens, cache hit, rounds and steps through the shared meter https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      jest
        .mocked(useAgentChatRuntimeState)
        .mockReturnValue({ messages: [], queuedPrompts: [] } as unknown as ReturnType<
          typeof useAgentChatRuntimeState
        >);
      (window as unknown as { activeDocument: Document }).activeDocument = window.document;
      const usage: SessionUsage = {
        usedTokens: 0,
        updatedAt: 1,
        metrics: {
          totalTokens: 3262,
          inputTokens: 3000,
          outputTokens: 262,
          cacheReadTokens: 1500,
          cacheHitPercent: 50,
          rounds: 2,
          steps: 4,
          partial: false,
          sources: [],
        },
      };
      const snapshot: SubagentSessionSnapshot = {
        id: "child-audit",
        parentSessionId: "parent",
        name: "资料核对",
        modelId: "model",
        cwd: "/vault",
        retention: "retained",
        createdAt: 1,
        updatedAt: 1,
        runs: [],
        messages: [],
      };
      const getSubagentUsage = jest.fn(() => usage);
      const parent = {
        getSubagentSessions: () => [snapshot],
        getSubagentUsage,
        getSessionUsage: () => ({ ...usage, metrics: { ...usage.metrics, totalTokens: 99999 } }),
        subscribe: () => () => {},
      } as unknown as AgentChatBackend;
      render(
        <TooltipProvider>
          <SubagentChatPanel
            app={{} as App}
            plugin={{} as ScribePlugin}
            manager={{} as AgentSessionManager}
            parentBackend={parent}
            subagentId="child-audit"
            onBack={() => {}}
          />
        </TooltipProvider>
      );

      const trigger = screen.getByLabelText("Usage");
      expect(trigger.textContent).toContain("3.3k token");
      expect(trigger.textContent).toContain("Cache hit 50%");
      fireEvent.focus(trigger);
      expect(screen.getAllByText("2 rounds · 4 steps").length).toBeGreaterThan(0);
      expect(getSubagentUsage).toHaveBeenCalledWith("child-audit");
    });
  });
});
