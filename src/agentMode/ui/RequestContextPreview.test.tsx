import {
  RequestContextPreviewDialog,
  RequestContextPreviewModal,
  RequestContextPreviewView,
} from "@/agentMode/ui/RequestContextPreview";
import { fireEvent, render, screen } from "@testing-library/react";
import type { RequestContextPreview } from "@/agentMode/session/types";
import type { App } from "obsidian";
import React from "react";

const preview: RequestContextPreview = {
  requestId: "request-1",
  modelId: "model-1",
  provider: "provider-1",
  content: '{"messages":[{"role":"user","content":"Original selection"}]}',
};

class PreviewModalFixture extends RequestContextPreviewModal {
  renderBody(close: () => void) {
    return this.renderContent(close);
  }
}

describe("RequestContextPreview", () => {
  describe("RequestContextPreviewView()", () => {
    it("shows saved content as read-only text and closes without changing it", () => {
      const close = jest.fn();
      render(<RequestContextPreviewView preview={preview} onClose={close} />);
      const input = screen.getByRole<HTMLTextAreaElement>("textbox", {
        name: "Saved request input",
      });
      expect(input.value).toBe(preview.content);
      expect(input.readOnly).toBe(true);
      expect(screen.getByText("provider-1 · model-1 · request-1")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(close).toHaveBeenCalledTimes(1);
    });
    it("explains when an older chat has no saved request record", () => {
      render(<RequestContextPreviewView onClose={() => {}} />);
      expect(screen.getByText(/Older chats may not contain request records/)).toBeTruthy();
      expect(screen.queryByRole("textbox")).toBeNull();
    });
    it("shows a loading state while saved content is being read", () => {
      render(<RequestContextPreviewView loading onClose={() => {}} />);
      expect(screen.getByRole("status").textContent).toBe("Loading saved request...");
    });
    it("shows a failed read instead of presenting a partial input", () => {
      render(<RequestContextPreviewView error="Saved input is damaged" onClose={() => {}} />);
      expect(screen.getByRole("alert").textContent).toBe("Saved input is damaged");
      expect(screen.queryByRole("textbox")).toBeNull();
    });
  });
  describe("RequestContextPreviewDialog()", () => {
    it("reads the saved preview once and shows its original content", async () => {
      const load = jest.fn(async () => preview);
      render(<RequestContextPreviewDialog load={load} onClose={() => {}} />);
      expect(await screen.findByRole("textbox")).toHaveProperty("value", preview.content);
      expect(load).toHaveBeenCalledTimes(1);
    });
    it("reports an unavailable request when the saved lookup returns none", async () => {
      render(<RequestContextPreviewDialog load={async () => null} onClose={() => {}} />);
      expect(await screen.findByText(/Older chats may not contain request records/)).toBeTruthy();
    });
    it("reports the recorded read failure without sending another model request", async () => {
      const load = jest.fn(async () => {
        throw new Error("Saved input is damaged");
      });
      render(<RequestContextPreviewDialog load={load} onClose={() => {}} />);
      expect((await screen.findByRole("alert")).textContent).toBe("Saved input is damaged");
      expect(load).toHaveBeenCalledTimes(1);
    });
  });
  describe("RequestContextPreviewModal", () => {
    describe("renderContent()", () => {
      it("loads the saved preview inside the modal and forwards its close action", async () => {
        const close = jest.fn();
        const modal = new PreviewModalFixture({} as App, async () => preview);
        render(modal.renderBody(close));
        expect(await screen.findByRole("textbox")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(close).toHaveBeenCalledTimes(1);
      });
    });
  });
});
