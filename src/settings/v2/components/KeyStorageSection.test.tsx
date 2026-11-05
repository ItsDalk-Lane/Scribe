import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { KeyStorageSection } from "./KeyStorageSection";

describe("KeyStorageSection", () => {
  describe("KeyStorageSection()", () => {
    it("shows the storage method and invokes the deletion action when the interface exists", () => {
      const onForget = jest.fn();
      render(<KeyStorageSection keychainAvailable forgetting={false} onForget={onForget} />);

      expect(screen.getByText("Obsidian Keychain")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Delete All Keys" }));
      expect(onForget).toHaveBeenCalledTimes(1);
    });

    it("prevents deletion while the keychain interface is unavailable", () => {
      const onForget = jest.fn();
      render(
        <KeyStorageSection keychainAvailable={false} forgetting={false} onForget={onForget} />
      );

      expect(screen.getByText("Unavailable")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Delete All Keys" }));
      expect(onForget).not.toHaveBeenCalled();
    });

    it("prevents duplicate deletion while removal is in progress", () => {
      const onForget = jest.fn();
      render(<KeyStorageSection keychainAvailable forgetting onForget={onForget} />);

      fireEvent.click(screen.getByRole("button", { name: "Removing..." }));
      expect(onForget).not.toHaveBeenCalled();
    });
  });
});
