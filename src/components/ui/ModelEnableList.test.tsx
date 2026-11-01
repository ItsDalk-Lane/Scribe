import { ModelEnableList, type ModelEnableGroup } from "@/components/ui/ModelEnableList";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const GROUPS: ModelEnableGroup[] = [
  {
    key: "provider-a",
    label: "Provider A",
    rows: [{ id: "a-1", label: "Model A1", enabled: false }],
  },
  {
    key: "provider-b",
    label: "Provider B",
    rows: [{ id: "b-1", label: "Model B1", enabled: false }],
  },
];

function groupState(label: string): string | null | undefined {
  const heading = screen.getByText(label);
  return heading.closest("[data-state]")?.getAttribute("data-state");
}

function renderList(props?: Partial<React.ComponentProps<typeof ModelEnableList>>) {
  const onQueryChange = jest.fn();
  const utils = render(
    <ModelEnableList
      groups={GROUPS}
      onToggle={jest.fn()}
      query=""
      onQueryChange={onQueryChange}
      {...props}
    />
  );
  return { onQueryChange, ...utils };
}

describe("ModelEnableList", () => {
  describe("ModelEnableList()", () => {
    it("toggles an available model", () => {
      const onToggle = jest.fn();
      renderList({ onToggle });
      fireEvent.click(screen.getAllByRole("switch")[0]);
      expect(onToggle).toHaveBeenCalledWith("a-1", true);
    });

    it("shows a collapsed group's selected-model count beside its provider name", () => {
      renderList({
        groups: [
          {
            key: "provider-a",
            label: "Provider A",
            rows: [
              { id: "a-1", label: "Model A1", enabled: true },
              { id: "a-2", label: "Model A2", enabled: false },
              { id: "a-3", label: "Model A3", enabled: true },
            ],
          },
          GROUPS[1],
        ],
        defaultOpenGroupKey: "provider-b",
      });
      expect(groupState("Provider A")).toBe("closed");
      expect(screen.getByTitle("2 selected").textContent).toBe("2");
    });

    it("omits the selected-model badge for a provider with no selected models (https://github.com/Brevilabs/obsidian-copilot-private/issues/631)", () => {
      renderList();
      expect(screen.queryByTitle(/selected/)).toBeNull();
    });

    it("opens every group by default when no defaultOpenGroupKey is given", () => {
      renderList();
      expect(groupState("Provider A")).toBe("open");
      expect(groupState("Provider B")).toBe("open");
    });

    it("opens only the defaultOpenGroupKey group, collapsing the rest", () => {
      renderList({ defaultOpenGroupKey: "provider-a" });
      expect(groupState("Provider A")).toBe("open");
      expect(groupState("Provider B")).toBe("closed");
    });

    it("forces every group open while searching, ignoring the default", () => {
      renderList({ defaultOpenGroupKey: "provider-a", query: "Model" });
      expect(groupState("Provider A")).toBe("open");
      expect(groupState("Provider B")).toBe("open");
    });

    it("re-applies the collapsed default once the search query clears", () => {
      const { rerender } = renderList({ defaultOpenGroupKey: "provider-a", query: "Model" });
      expect(groupState("Provider B")).toBe("open");
      rerender(
        <ModelEnableList
          groups={GROUPS}
          onToggle={jest.fn()}
          query=""
          onQueryChange={jest.fn()}
          defaultOpenGroupKey="provider-a"
        />
      );
      expect(groupState("Provider A")).toBe("open");
      expect(groupState("Provider B")).toBe("closed");
    });

    it("remembers a user's explicit expand of a non-default group across props updates", () => {
      const { rerender } = renderList({ defaultOpenGroupKey: "provider-a" });
      fireEvent.click(screen.getByText("Provider B"));
      expect(groupState("Provider B")).toBe("open");
      rerender(
        <ModelEnableList
          groups={GROUPS}
          onToggle={jest.fn()}
          query=""
          onQueryChange={jest.fn()}
          defaultOpenGroupKey="provider-a"
        />
      );
      expect(groupState("Provider B")).toBe("open");
    });

    it("applies the collapsed default to groups that appear after an empty first render", () => {
      const { rerender } = render(
        <ModelEnableList
          groups={[]}
          onToggle={jest.fn()}
          query=""
          onQueryChange={jest.fn()}
          defaultOpenGroupKey="provider-a"
        />
      );
      rerender(
        <ModelEnableList
          groups={GROUPS}
          onToggle={jest.fn()}
          query=""
          onQueryChange={jest.fn()}
          defaultOpenGroupKey="provider-a"
        />
      );
      expect(groupState("Provider A")).toBe("open");
      expect(groupState("Provider B")).toBe("closed");
    });
  });
});
