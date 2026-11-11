import { act, renderHook } from "@testing-library/react";
import { useChatModelPicker } from "./useChatModelPicker";
const mockEntries = [
  {
    state: "ok",
    configuredModelId: "model-a",
    provider: {
      providerId: "p",
      providerType: "openai-compatible",
      displayName: "OpenAI",
      origin: { kind: "byok", catalogProviderId: "openai" },
      requiresApiKey: false,
    },
    configuredModel: {
      configuredModelId: "model-a",
      providerId: "p",
      info: { id: "gpt-4o", displayName: "GPT-4o" },
    },
  },
  {
    state: "ok",
    configuredModelId: "model-z",
    provider: {
      providerId: "z",
      providerType: "openai-compatible",
      displayName: "Zeta",
      origin: { kind: "byok" },
      requiresApiKey: false,
    },
    configuredModel: {
      configuredModelId: "model-z",
      providerId: "z",
      info: { id: "claude", displayName: "Claude" },
    },
  },
];
/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hooks; names must match the exports */
jest.mock("jotai", () => ({ useAtomValue: () => mockEntries }));
jest.mock("@/modelManagement", () => ({
  ...jest.requireActual<typeof import("@/modelManagement/chatModel/chatModelSelection")>(
    "@/modelManagement/chatModel/chatModelSelection"
  ),
  chatBackendPickerAtom: "chat",
  capabilitiesFromConfiguredInfo: () => ({}),
  mapProviderTypeToChatModelProvider: () => "openai",
  providerRequiresApiKey: () => false,
}));
jest.mock("@/settings/model", () => ({
  settingsStore: {},
  getModelKeyFromModel: (model: { name: string; provider: string }) =>
    `${model.name}|${model.provider}`,
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
describe("useChatModelPicker", () => {
  describe("useChatModelPicker", () => {
    it("shows the explicitly selected legacy model and returns configured IDs on selection", () => {
      const onChange = jest.fn();
      const { result } = renderHook(() =>
        useChatModelPicker({ value: "gpt-4o|openai", onChange, fallbackToFirst: false })
      );
      expect(result.current.value).toBe("model-a|openai");
      act(() => result.current.onChange("model-a|openai"));
      expect(onChange).toHaveBeenCalledWith("model-a");
    });
    it.each([undefined, "", "removed"])(
      "keeps strict selection %s empty until the user picks",
      (value) => {
        const { result } = renderHook(() =>
          useChatModelPicker({ value, onChange: jest.fn(), fallbackToFirst: false })
        );
        expect(result.current.value).toBe("");
        expect(result.current.models[0].displayName).toBe("GPT-4o");
      }
    );
    it("retains first-model fallback for chat callers", () => {
      const { result } = renderHook(() =>
        useChatModelPicker({ value: "removed", onChange: jest.fn() })
      );
      expect(result.current.value).toBe("model-a|openai");
    });
    it("groups entries by provider display name and sorts groups alphabetically https://github.com/ItsDalk-Lane/Scribe/issues/69", () => {
      const { result } = renderHook(() =>
        useChatModelPicker({ value: "x|openai", onChange: jest.fn(), fallbackToFirst: false })
      );
      expect(result.current.models.map((model) => [model.displayName, model._group])).toEqual([
        ["GPT-4o", "OpenAI"],
        ["Claude", "Zeta"],
      ]);
    });
  });
});
