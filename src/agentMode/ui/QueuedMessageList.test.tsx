import { QueuedMessageList } from "@/agentMode/ui/QueuedMessageList";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
describe("QueuedMessageList", () => {
  describe("QueuedMessageList", () => {
    it("labels image-only rows and keeps their removal", () => {
      const onRemove = jest.fn();
      render(
        <QueuedMessageList
          delivering={[]}
          held={[
            {
              id: "image",
              text: "",
              rawInput: "",
              promptContent: [{ type: "image", mimeType: "image/png", data: "AQID" }],
            },
          ]}
          onRemove={onRemove}
        />
      );
      expect(screen.getByTitle("Image attachment")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Remove queued message" }));
      expect(onRemove).toHaveBeenCalledWith("image");
    });
    it("labels an empty command without claiming it contains an image", () => {
      render(
        <QueuedMessageList
          delivering={[]}
          held={[{ id: "empty", text: "", rawInput: "/empty" }]}
          onRemove={jest.fn()}
        />
      );
      expect(screen.getByTitle("Empty message")).toBeTruthy();
    });
    it("displays the text of a queued message", () => {
      render(
        <QueuedMessageList
          delivering={[]}
          held={[{ id: "text", text: "Explain this", rawInput: "Explain this" }]}
          onRemove={jest.fn()}
        />
      );
      expect(screen.getByTitle("Explain this")).toBeTruthy();
    });

    it("captions messages handed to the agent with when the agent reads them, without a per-row status word or a remove control", () => {
      render(
        <QueuedMessageList
          delivering={[
            { id: "steer-1", text: "Only the first two" },
            { id: "steer-2", text: "Keep it short" },
          ]}
          held={[]}
          onRemove={jest.fn()}
        />
      );
      expect(screen.getByTitle("Only the first two")).toBeTruthy();
      expect(screen.getAllByText("The agent reads these at its next step")).toHaveLength(1);
      expect(screen.queryByText("Queued")).toBeNull();
      expect(screen.queryByRole("button", { name: "Remove queued message" })).toBeNull();
      expect(screen.queryByText("Sends when the agent finishes")).toBeNull();
    });

    it("groups a mixed list under one caption per group, so each message's state reads from the caption above it", () => {
      const { container } = render(
        <QueuedMessageList
          delivering={[{ id: "steer", text: "Only the first two" }]}
          held={[{ id: "compact", text: "/compact", rawInput: "/compact" }]}
          onRemove={jest.fn()}
        />
      );
      expect(container.textContent).toBe(
        "The agent reads these at its next stepOnly the first twoSends when the agent finishes/compact"
      );
    });

    it("offers a withdraw control on each message handed to a backend that can withdraw it, and withdraws that message", () => {
      const onWithdraw = jest.fn();
      render(
        <QueuedMessageList
          delivering={[
            { id: "steer-1", text: "Only the first two" },
            { id: "steer-2", text: "Keep it short" },
          ]}
          held={[]}
          onRemove={jest.fn()}
          onWithdraw={onWithdraw}
        />
      );

      const controls = screen.getAllByRole("button", { name: "Withdraw queued message" });
      fireEvent.click(controls[1]);

      expect(controls).toHaveLength(2);
      expect(onWithdraw).toHaveBeenCalledWith("steer-2");
    });

    it("offers one Send now for all messages the agent reads at its next step, never one per message", () => {
      const onSendNow = jest.fn();
      render(
        <QueuedMessageList
          delivering={[
            { id: "steer-1", text: "Only the first two" },
            { id: "steer-2", text: "Keep it short" },
          ]}
          held={[{ id: "compact", text: "/compact", rawInput: "/compact" }]}
          onRemove={jest.fn()}
          onSendNow={onSendNow}
        />
      );

      const controls = screen.getAllByRole("button", { name: "Send waiting messages now" });
      fireEvent.click(controls[0]);

      expect(controls).toHaveLength(1);
      expect(onSendNow).toHaveBeenCalledTimes(1);
    });

    it("offers no Send now when only messages Scribe holds are waiting", () => {
      render(
        <QueuedMessageList
          delivering={[]}
          held={[{ id: "compact", text: "/compact", rawInput: "/compact" }]}
          onRemove={jest.fn()}
          onSendNow={jest.fn()}
        />
      );

      expect(screen.queryByRole("button", { name: "Send waiting messages now" })).toBeNull();
    });

    it("tells the user that messages Scribe holds send when the agent finishes", () => {
      render(
        <QueuedMessageList
          delivering={[]}
          held={[{ id: "held", text: "Next question", rawInput: "Next question" }]}
          onRemove={jest.fn()}
        />
      );
      expect(screen.getByText("Sends when the agent finishes")).toBeTruthy();
    });
  });
});
