import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import { SelectedModelList } from "./SelectedModelList";

function renderList(overrides: Partial<React.ComponentProps<typeof SelectedModelList>> = {}) {
  const props: React.ComponentProps<typeof SelectedModelList> = {
    availableModels: [],
    selected: new Set<string>(),
    onToggle: jest.fn(),
    ...overrides,
  };
  render(<SelectedModelList {...props} />);
  return props;
}

const RICH: ModelInfo = {
  id: "claude-sonnet-4-5",
  displayName: "Claude Sonnet 4.5",
  releaseDate: "2025-09-01",
  limits: { context: 200000 },
};

const PLAIN: ModelInfo = { id: "gpt-5", displayName: "gpt-5" };

describe("SelectedModelList", () => {
  it("shows the empty state when no model is selected", () => {
    renderList({ availableModels: [RICH] });
    expect(screen.getByTestId("selected-model-list-empty")).toBeTruthy();
    expect(screen.queryByTestId("selected-model-list")).toBeNull();
  });

  it("lists only the models whose ids are selected", () => {
    renderList({ availableModels: [RICH, PLAIN], selected: new Set([PLAIN.id]) });
    expect(screen.getByTestId("model-row-gpt-5")).toBeTruthy();
    expect(screen.queryByTestId("model-row-claude-sonnet-4-5")).toBeNull();
  });

  it("renders every row checkbox as ticked", () => {
    renderList({ availableModels: [RICH, PLAIN], selected: new Set([RICH.id, PLAIN.id]) });
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    for (const checkbox of checkboxes) {
      expect(checkbox.getAttribute("data-state")).toBe("checked");
    }
  });

  it("orders the rows by release date with the newest first", () => {
    renderList({ availableModels: [PLAIN, RICH], selected: new Set([RICH.id, PLAIN.id]) });
    const rows = screen.getAllByRole("listitem");
    expect(rows[0].getAttribute("data-testid")).toBe("model-row-claude-sonnet-4-5");
    expect(rows[1].getAttribute("data-testid")).toBe("model-row-gpt-5");
  });

  it("calls onToggle with false when a row checkbox is unticked", () => {
    const onToggle = jest.fn();
    renderList({ availableModels: [PLAIN], selected: new Set([PLAIN.id]), onToggle });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledWith("gpt-5", false);
  });

  it("drops a row once its id is no longer selected", () => {
    const view = render(
      <SelectedModelList
        availableModels={[PLAIN]}
        selected={new Set([PLAIN.id])}
        onToggle={jest.fn()}
      />
    );
    expect(screen.getByTestId("model-row-gpt-5")).toBeTruthy();
    view.rerender(
      <SelectedModelList
        availableModels={[PLAIN]}
        selected={new Set<string>()}
        onToggle={jest.fn()}
      />
    );
    expect(screen.queryByTestId("model-row-gpt-5")).toBeNull();
    expect(screen.getByTestId("selected-model-list-empty")).toBeTruthy();
  });

  it("offers no per-row remove button", () => {
    renderList({ availableModels: [PLAIN], selected: new Set([PLAIN.id]) });
    expect(screen.queryByTestId("model-row-remove-gpt-5")).toBeNull();
  });

  it("renders the context and input-modality labels beside the model name when declared https://github.com/ItsDalk-Lane/Scribe/issues/67", () => {
    renderList({
      availableModels: [
        {
          id: "vision",
          displayName: "Vision",
          limits: { context: 262144 },
          modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        },
      ],
      selected: new Set(["vision"]),
    });
    expect(screen.getByTestId("model-row-context-vision").textContent).toBe("262K");
    expect(screen.getByTestId("model-modality-image")).toBeTruthy();
    expect(screen.getByTestId("model-modality-pdf")).toBeTruthy();
    expect(screen.queryByTestId("model-modality-video")).toBeNull();
  });

  it("omits modality labels for models without a declared input list https://github.com/ItsDalk-Lane/Scribe/issues/67", () => {
    renderList({ availableModels: [PLAIN], selected: new Set([PLAIN.id]) });
    expect(screen.queryByTestId("model-modality-image")).toBeNull();
  });

  it("opens the per-model config from the row edit button https://github.com/ItsDalk-Lane/Scribe/issues/67", () => {
    const onEdit = jest.fn();
    renderList({ availableModels: [PLAIN], selected: new Set([PLAIN.id]), onEdit });
    fireEvent.click(screen.getByTestId("model-row-edit-gpt-5"));
    expect(onEdit).toHaveBeenCalledWith(PLAIN);
  });

  it("hides the edit button when no edit handler is provided https://github.com/ItsDalk-Lane/Scribe/issues/67", () => {
    renderList({ availableModels: [PLAIN], selected: new Set([PLAIN.id]) });
    expect(screen.queryByTestId("model-row-edit-gpt-5")).toBeNull();
  });

  it("shows the deprecated badge for deprecated catalog entries https://github.com/ItsDalk-Lane/Scribe/issues/67", () => {
    renderList({
      availableModels: [{ id: "old", displayName: "Old", status: "deprecated" }],
      selected: new Set(["old"]),
    });
    expect(screen.getByText("Deprecated")).toBeTruthy();
  });
});
