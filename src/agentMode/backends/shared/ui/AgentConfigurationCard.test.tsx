import { AgentConfigurationCard } from "@/agentMode/backends/shared/ui/AgentConfigurationCard";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("AgentConfigurationCard", () => {
  describe("AgentConfigurationCard()", () => {
    const props = {
      displayName: "Claude Code",
      Icon: () => null,
      installState: { kind: "ready", source: "custom" } as const,
      managedInstall: { kind: "idle" } as const,
      resolvedPath: "/local/claude",
      onConfigure: jest.fn(),
      enabled: true,
      onEnabledChange: jest.fn(),
    };
    it("keeps installation details under the card's only disclosure and places an agent switch beside it", () => {
      render(<AgentConfigurationCard {...props} />);
      expect(screen.queryByText("/local/claude")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Agent configuration" }));
      expect(screen.getByText("/local/claude")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Configure" }));
      expect(props.onConfigure).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("switch", { name: "Enable Claude Code" }));
      expect(props.onEnabledChange).toHaveBeenCalledWith(false);
    });
    it("shows the detected version beside the agent name", () => {
      render(
        <AgentConfigurationCard
          {...props}
          installState={{ kind: "ready", source: "custom", version: "2.1.281" }}
        />
      );
      expect(screen.getByText("v2.1.281")).toBeTruthy();
    });
    it("shows that tasks are finishing while the agent's saved switch is off", () => {
      render(<AgentConfigurationCard {...props} enabled={false} pendingDisable />);
      expect(screen.getByText("Finishing current tasks before disabling.")).toBeTruthy();
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    });
  });
});
