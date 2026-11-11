import React from "react";
import type { App } from "obsidian";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { requestSecretUnlock } from "@/services/ui/SecretUnlockModal";
import type { SecretUnlockRequest } from "@/services/secretStore";

let mockActive: { renderContent(close: () => void): React.ReactElement; close(): void };
jest.mock("@/components/modals/ReactModal", () => ({
  ReactModal: class {
    onOpen() {}
    onClose() {}
    open() {
      mockActive = this as unknown as typeof mockActive;
      this.onOpen();
    }
    close() {
      this.onClose();
    }
  },
}));

describe("SecretUnlockModal", () => {
  describe("requestSecretUnlock()", () => {
    it("closes and cancels its pending unlock when the plugin stops", async () => {
      const controller = new AbortController();
      const request: SecretUnlockRequest = {
        creating: false,
        signal: controller.signal,
        cancel: jest.fn(),
        submit: jest.fn(),
        reset: jest.fn(),
      };
      const closed = requestSecretUnlock({} as App, request);
      controller.abort();
      await closed;
      expect(request.cancel).toHaveBeenCalledTimes(1);
    });

    it("submits the password and closes after a successful unlock", async () => {
      const request: SecretUnlockRequest = {
        creating: false,
        signal: new AbortController().signal,
        cancel: jest.fn(),
        submit: jest.fn(async () => {}),
        reset: jest.fn(),
      };
      const closed = requestSecretUnlock({} as App, request);
      render(mockActive.renderContent(() => mockActive.close()));
      fireEvent.change(screen.getByLabelText("Master password"), {
        target: { value: "synthetic-password" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
      await closed;
      await waitFor(() => expect(request.submit).toHaveBeenCalledWith("synthetic-password"));
      expect(request.cancel).not.toHaveBeenCalled();
    });
  });
});
