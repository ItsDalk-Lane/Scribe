import {
  AssistantResponseFooter,
  type AssistantResponseFooterProps,
} from "@/components/ui/AssistantResponseFooter";
import { render, screen } from "@testing-library/react";
import React from "react";

const renderFooter = (props: Partial<AssistantResponseFooterProps> = {}) =>
  render(<AssistantResponseFooter actions={<span>Actions</span>} {...props} />);

describe("AssistantResponseFooter", () => {
  describe("AssistantResponseFooter()", () => {
    it("keeps the timestamp and appends usage metadata before response actions https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      renderFooter({
        timestamp: "2026/11/08 12:00:00",
        ...{ afterTimestamp: <span>120 token · 30 token/s</span> },
      });
      expect(screen.getByText("2026/11/08 12:00:00")).toBeTruthy();
      expect(screen.getByText("120 token · 30 token/s")).toBeTruthy();
      expect(screen.getByText("Actions")).toBeTruthy();
    });
    it("prefers leading metadata over the timestamp and keeps actions at the trailing edge", () => {
      const { container } = renderFooter({
        leading: <span>Worked for 24s</span>,
        timestamp: "2026/08/07 20:31:10",
      });

      expect(screen.getByText("Worked for 24s")).toBeTruthy();
      expect(screen.queryByText("2026/08/07 20:31:10")).toBeNull();
      expect(screen.getByText("Actions")).toBeTruthy();
      expect(container.querySelector("[data-response-footer-leading]")).not.toBeNull();
    });

    it("shows the timestamp when leading metadata is absent", () => {
      const { container } = renderFooter({
        timestamp: "2026/08/07 20:31:10",
        actions: undefined,
      });

      expect(screen.getByText("2026/08/07 20:31:10")).toBeTruthy();
      expect(container.querySelector("[data-response-footer-leading]")).toBeNull();
      expect(container.querySelector("[data-response-footer-actions]")).toBeNull();
    });

    it("shows only the actions when the footer has no metadata", () => {
      const { container } = renderFooter({ leading: null });

      expect(screen.getByText("Actions")).toBeTruthy();
      expect(container.querySelector("[data-response-footer-leading]")).toBeNull();
    });
  });
});
