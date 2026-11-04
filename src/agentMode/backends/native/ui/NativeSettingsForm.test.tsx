import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react-dom/test-utils";
import { NativeSettingsForm } from "@/agentMode/backends/native/ui/NativeSettingsForm";

describe("NativeSettingsForm", () => {
  describe("NativeSettingsForm()", () => {
    it("keeps an unavailable saved model visible instead of displaying a different default", () => {
      render(
        <NativeSettingsForm
          settings={{ defaultModel: { baseModelId: "removed-model", effort: null } }}
          models={[]}
          onChange={jest.fn()}
        />
      );
      expect((screen.getAllByRole("combobox")[0] as HTMLSelectElement).value).toBe("removed-model");
      expect(screen.getByRole("option", { name: "Unavailable model: removed-model" })).toBeTruthy();
    });

    it("presents existing models and sends the exact selected model and permission mode", () => {
      const onChange = jest.fn();
      render(
        <NativeSettingsForm
          settings={{}}
          models={[{ baseModelId: "custom-id", name: "Custom model", credentialState: "ok" }]}
          onChange={onChange}
        />
      );
      const selects = screen.getAllByRole("combobox");
      fireEvent.change(selects[0], { target: { value: "custom-id" } });
      expect(onChange).toHaveBeenLastCalledWith({
        defaultModel: { baseModelId: "custom-id", effort: null },
      });
      fireEvent.change(selects[1], { target: { value: "plan" } });
      expect(onChange).toHaveBeenLastCalledWith({ defaultMode: "plan" });
      fireEvent.change(selects[0], { target: { value: "" } });
      expect(onChange).toHaveBeenLastCalledWith({ defaultModel: null });
    });
    it("saves a valid step limit after the existing input debounce and ignores out-of-range values", () => {
      jest.useFakeTimers();
      try {
        const onChange = jest.fn();
        render(<NativeSettingsForm settings={{ maxSteps: 50 }} models={[]} onChange={onChange} />);
        const input = screen.getByRole("spinbutton");
        fireEvent.change(input, { target: { value: "75" } });
        act(() => jest.advanceTimersByTime(1000));
        expect(onChange).toHaveBeenLastCalledWith({ maxSteps: 75 });
        fireEvent.change(input, { target: { value: "-1" } });
        act(() => jest.advanceTimersByTime(1000));
        expect(onChange).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
