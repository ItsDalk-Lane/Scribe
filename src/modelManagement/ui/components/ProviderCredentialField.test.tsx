import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ProviderCredentialField,
  type ProviderCredentialFieldProps,
} from "./ProviderCredentialField";

function props(): ProviderCredentialFieldProps {
  return {
    label: "API key",
    value: "",
    hasSavedKey: true,
    clearRequested: false,
    required: true,
    editableExisting: true,
    saving: false,
    onChange: jest.fn(),
    onClear: jest.fn(),
  };
}

describe("ProviderCredentialField", () => {
  describe("ProviderCredentialField()", () => {
    it("shows that a key is saved while leaving its input empty", () => {
      render(<ProviderCredentialField {...props()} />);
      expect(screen.getByPlaceholderText("Saved key — leave blank to keep it")).toHaveProperty(
        "value",
        ""
      );
      expect(screen.getByText("Saved key")).toBeTruthy();
    });
    it("requests explicit clearing and explains that removal happens when saving", () => {
      const value = props();
      const { rerender } = render(<ProviderCredentialField {...value} />);
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      expect(value.onClear).toHaveBeenCalledTimes(1);
      rerender(<ProviderCredentialField {...value} clearRequested />);
      expect(screen.getByText("The saved key will be removed when you save.")).toBeTruthy();
      expect(screen.queryByText("Saved key")).toBeNull();
    });
    it("disables credential editing while saving", () => {
      render(<ProviderCredentialField {...props()} saving />);
      expect(screen.getByPlaceholderText("Saved key — leave blank to keep it")).toHaveProperty(
        "disabled",
        true
      );
      expect(screen.getByRole("button", { name: "Clear" })).toHaveProperty("disabled", true);
    });
  });
});
