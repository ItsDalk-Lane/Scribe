import {
  ScribeFolderChangeNotice,
  type ScribeFolderChangeNoticeProps,
} from "@/settings/v2/components/ScribeFolderChangeNotice";
import { render, screen } from "@testing-library/react";
import React from "react";

const DEFAULT_PROPS: ScribeFolderChangeNoticeProps = {
  oldRoot: "scribe",
  newRoot: "90 System/scribe",
  containsMarkdown: false,
};

describe("ScribeFolderChangeNotice", () => {
  describe("ScribeFolderChangeNotice()", () => {
    it("explains where new and existing Scribe data will remain", () => {
      render(<ScribeFolderChangeNotice {...DEFAULT_PROPS} />);

      expect(screen.getByText("90 System/scribe/", { selector: "code" })).not.toBeNull();
      expect(screen.getByText("scribe/", { selector: "strong" })).not.toBeNull();
      expect(screen.getByText(/stays permanently excluded from Scribe search/)).not.toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("warns that every Markdown file in a non-empty folder will stay excluded", () => {
      render(<ScribeFolderChangeNotice {...DEFAULT_PROPS} containsMarkdown />);

      const warning = screen.getByRole("alert");
      expect(warning.textContent).toContain("This folder already contains Markdown files.");
      expect(warning.textContent).toContain("including regular notes");
      expect(warning.textContent).toContain("excluded from Scribe search");
      expect(warning.textContent).toContain("stays excluded even if you change");
    });
  });
});
