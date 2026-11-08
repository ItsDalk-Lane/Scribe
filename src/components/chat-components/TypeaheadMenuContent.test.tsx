import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  SlashSourceBadge,
  TypeaheadMenuContent,
  type TypeaheadOption,
} from "@/components/chat-components/TypeaheadMenuContent";

const GROUPED_ISSUE_URL = "https://github.com/ItsDalk-Lane/Scribe/issues/54";

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

function makeOption(overrides: Partial<TypeaheadOption> & { key: string; title: string }) {
  return { ...overrides };
}

describe("TypeaheadMenuContent", () => {
  describe("TypeaheadMenuContent()", () => {
    it(`renders one non-interactive group header before the first option of each group ${GROUPED_ISSUE_URL}`, () => {
      const onSelect = jest.fn();
      render(
        <TypeaheadMenuContent
          options={[
            makeOption({ key: "a", title: "compact", group: "Commands" }),
            makeOption({ key: "b", title: "draft", group: "Commands" }),
            makeOption({ key: "c", title: "summarize", group: "Skills" }),
          ]}
          selectedIndex={0}
          onSelect={onSelect}
          onHighlight={() => undefined}
        />
      );

      expect(screen.getByText("Commands")).toBeTruthy();
      expect(screen.getAllByText("Skills")).toHaveLength(1);
      fireEvent.mouseDown(screen.getByText("Commands"));
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("renders no group header when options carry no group", () => {
      render(
        <TypeaheadMenuContent
          options={[makeOption({ key: "a", title: "summarize" })]}
          selectedIndex={0}
          onSelect={() => undefined}
          onHighlight={() => undefined}
        />
      );
      expect(screen.getByText("summarize")).toBeTruthy();
    });

    it(`renders trailing source badges beside option titles ${GROUPED_ISSUE_URL}`, () => {
      render(
        <TypeaheadMenuContent
          options={[
            makeOption({
              key: "a",
              title: "compact",
              group: "Commands",
              trailingContent: <SlashSourceBadge label="Built-in" />,
            }),
          ]}
          selectedIndex={0}
          onSelect={() => undefined}
          onHighlight={() => undefined}
        />
      );
      expect(screen.getByText("Built-in")).toBeTruthy();
    });
  });
});
