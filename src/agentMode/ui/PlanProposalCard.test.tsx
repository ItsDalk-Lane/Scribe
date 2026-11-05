import { PlanProposalCard } from "@/agentMode/ui/PlanProposalCard";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { CurrentPlan } from "@/agentMode/session/types";
import { setInterfaceLocale } from "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

describe("PlanProposalCard", () => {
  describe("PlanProposalCard()", () => {
    afterEach(() => setInterfaceLocale("en"));

    it("shows the pending state and feedback guidance in Chinese", () => {
      setInterfaceLocale("zh-CN");
      const plan: CurrentPlan = {
        id: "plan-1",
        revision: 1,
        title: "Review the plan",
        body: "Plan content",
        permissionGated: true,
        decision: "pending",
      };

      render(<PlanProposalCard plan={plan} app={{} as App} chatBackend={{} as AgentChatBackend} />);

      expect(screen.getByText("待处理")).toBeTruthy();
      expect(screen.getByPlaceholderText("提供反馈以调整计划…")).toBeTruthy();
    });
  });
});
