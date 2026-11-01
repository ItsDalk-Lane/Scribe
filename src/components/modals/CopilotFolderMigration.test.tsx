import { setInterfaceLocale } from "@/lib/i18n";
import { CopilotFolderMigration } from "./CopilotFolderMigration";
import { render, screen } from "@testing-library/react";
import React from "react";

const WHY = /Scribe no longer supports hidden folders/;

describe("CopilotFolderMigration", () => {
  describe("CopilotFolderMigration()", () => {
    afterEach(() => setInterfaceLocale("en"));

    it("explains a failed move in Chinese while preserving original paths and failure details", () => {
      setInterfaceLocale("zh-CN");
      render(
        <CopilotFolderMigration
          migration={{
            status: "failed",
            from: ".private-notes",
            to: "visible-notes",
            reason: "EACCES",
          }}
        />
      );

      expect(
        screen.getByText(
          "Scribe 无法移动文件夹：EACCES。请手动将“.private-notes”中的内容移至“visible-notes”。"
        )
      ).toBeTruthy();
    });
    it("explains why the folder moved and names where it is now", () => {
      render(
        <CopilotFolderMigration
          migration={{ status: "moved", from: ".copilot", to: "copilot", leftBehind: [] }}
        />
      );

      expect(screen.getByText(WHY)).toBeTruthy();
      expect(screen.getByText('Your Scribe folder is now "copilot".')).toBeTruthy();
      expect(screen.queryByRole("list")).toBeNull();
    });

    it("lists the files that stayed in the hidden folder for the user to move", () => {
      render(
        <CopilotFolderMigration
          migration={{
            status: "moved",
            from: ".copilot",
            to: "copilot",
            leftBehind: [".copilot/memory/User Role.md"],
          }}
        />
      );

      expect(screen.getByText(/already has files with the same names/)).toBeTruthy();
      expect(screen.getByRole("listitem").textContent).toBe(".copilot/memory/User Role.md");
    });

    it("shows why the move failed and asks the user to move the folder", () => {
      render(
        <CopilotFolderMigration
          migration={{ status: "failed", from: ".copilot", to: "copilot", reason: "EACCES" }}
        />
      );

      expect(screen.getByText(WHY)).toBeTruthy();
      expect(
        screen.getByText(
          'Scribe could not move it: EACCES. Move the contents of ".copilot" to "copilot" yourself.'
        )
      ).toBeTruthy();
    });
  });
});
