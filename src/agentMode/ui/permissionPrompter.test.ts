import type { AgentSession } from "@/agentMode/session/AgentSession";
import {
  PERMISSION_OPTION_KINDS,
  type AgentToolKind,
  type PermissionPrompt,
} from "@/agentMode/session/types";
import { createDefaultPermissionPrompter } from "./permissionPrompter";

function promptFor(sessionId: string, kind: AgentToolKind): PermissionPrompt {
  return {
    sessionId,
    toolCall: { toolCallId: "t1", title: "tool", kind, status: "pending" },
    options: PERMISSION_OPTION_KINDS.map((k) => ({ optionId: k, name: k, kind: k })),
  };
}

describe("permissionPrompter", () => {
  describe("createDefaultPermissionPrompter", () => {
    it("routes a Codex collaboration plan review to the plan card", async () => {
      const handlePlanProposalPermission = jest
        .fn()
        .mockResolvedValue({ outcome: { outcome: "cancelled" } });
      const handleToolPermission = jest.fn();
      const session = {
        handlePlanProposalPermission,
        handleToolPermission,
      } as unknown as AgentSession;
      const prompter = createDefaultPermissionPrompter(() => session);
      const request = promptFor("codex", "switch_mode");
      request.toolCall.rawInput = { plan: "# Build the note" };

      await prompter(request);

      expect(handlePlanProposalPermission).toHaveBeenCalledWith(request);
      expect(handleToolPermission).not.toHaveBeenCalled();
    });
  });
});
