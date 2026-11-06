import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SecretUnlockForm } from "@/services/ui/SecretUnlockForm";

describe("SecretUnlockForm", () => {
  describe("SecretUnlockForm()", () => {
    it("requires a sufficiently long matching password before creating storage", async () => {
      const onSubmit = jest.fn(async () => {});
      render(
        <SecretUnlockForm
          creating
          onSubmit={onSubmit}
          onReset={async () => {}}
          onCancel={() => {}}
        />
      );
      fireEvent.change(screen.getByLabelText("Master password"), { target: { value: "short" } });
      fireEvent.click(screen.getByRole("button", { name: "Set password" }));
      expect(await screen.findByRole("alert")).toHaveProperty(
        "textContent",
        "Use at least 12 characters for your master password."
      );
      fireEvent.change(screen.getByLabelText("Master password"), {
        target: { value: "test-password-long" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Set password" }));
      expect(await screen.findByRole("alert")).toHaveProperty(
        "textContent",
        "The passwords do not match."
      );
      expect(onSubmit).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText("Confirm master password"), {
        target: { value: "test-password-long" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Set password" }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("test-password-long"));
    });

    it("keeps the dialog usable after a wrong password and allows retry", async () => {
      const onSubmit = jest.fn(async () => {}).mockRejectedValueOnce(new Error("Wrong password"));
      render(
        <SecretUnlockForm
          creating={false}
          onSubmit={onSubmit}
          onReset={async () => {}}
          onCancel={() => {}}
        />
      );
      fireEvent.change(screen.getByLabelText("Master password"), {
        target: { value: "incorrect" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
      expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Wrong password");
      fireEvent.change(screen.getByLabelText("Master password"), {
        target: { value: "correct-password" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    });

    it("offers explicit cancellation and reports a failed reset", async () => {
      const cancel = jest.fn();
      render(
        <SecretUnlockForm
          creating={false}
          onSubmit={async () => {}}
          onReset={async () => {
            throw new Error("read-only");
          }}
          onCancel={cancel}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Reset saved keys" }));
      expect(await screen.findByRole("alert")).toHaveProperty(
        "textContent",
        "Could not reset the saved keys. Please retry."
      );
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(cancel).toHaveBeenCalledTimes(1);
    });
  });
});
