import { ScribeSpinner } from "@/components/chat-components/ScribeSpinner";
import { render } from "@testing-library/react";
import React from "react";

describe("ScribeSpinner", () => {
  describe("ScribeSpinner()", () => {
    it("animates by default", () => {
      const { container } = render(<ScribeSpinner />);

      expect(container.querySelectorAll('[class*="scribe-spinner-dot-"]')).toHaveLength(7);
    });

    it("renders the same icon without animation classes when animation is disabled", () => {
      const { container } = render(<ScribeSpinner animated={false} />);

      expect(container.querySelectorAll(".scribe-spinner-dot")).toHaveLength(7);
      expect(container.querySelectorAll('[class*="scribe-spinner-dot-"]')).toHaveLength(0);
    });
  });
});
