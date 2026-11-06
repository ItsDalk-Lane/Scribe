import { renderHook } from "@testing-library/react";
import { useChatBackendModelOptions } from "./useChatBackendModelOptions";

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
    configuredModelId: "model-keyless",
    provider: {
      providerId: "k",
      providerType: "anthropic",
      displayName: "Anthropic",
      origin: { kind: "byok", catalogProviderId: "anthropic" },
      requiresApiKey: true,
    },
    configuredModel: {
      configuredModelId: "model-keyless",
      providerId: "k",
      info: { id: "claude", displayName: "Claude" },
    },
  },
];
// eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
jest.mock("jotai", () => ({ useAtomValue: () => mockEntries }));
jest.mock("@/modelManagement", () => ({
  ...jest.requireActual<typeof import("@/modelManagement/chatModel/chatModelSelection")>(
    "@/modelManagement/chatModel/chatModelSelection"
  ),
  chatBackendPickerAtom: "chat",
  providerNeedsResolvedApiKey: (provider: { requiresApiKey?: boolean; apiKeyRef?: string }) =>
    (provider.requiresApiKey ?? true) || !!provider.apiKeyRef,
  configuredModelToCustomModel: ({
    configuredModel,
  }: {
    configuredModel: { info: { id: string }; configuredModelId: string };
  }) => ({
    name: configuredModel.info.id,
    configuredModelId: configuredModel.configuredModelId,
  }),
}));
jest.mock("@/settings/model", () => ({ settingsStore: {} }));
const mockSecret = jest.fn();
jest.mock("@/services/secretStore", () => ({
  SecretStore: { getInstance: () => ({ getStatus: mockSecret }) },
}));

describe("useChatBackendModelOptions", () => {
  describe("useChatBackendModelOptions", () => {
    it("omits a saved key reference whose credential is unavailable on this device https://github.com/ItsDalk-Lane/Scribe/issues/31", () => {
      const provider = mockEntries[1].provider as (typeof mockEntries)[1]["provider"] & {
        apiKeyRef?: string;
      };
      provider.apiKeyRef = "missing-on-device";
      mockSecret.mockReturnValue("missing");
      try {
        const { result } = renderHook(() => useChatBackendModelOptions());
        expect(result.current.options.map((option) => option.value)).toEqual(["model-a"]);
        mockSecret.mockReturnValue("locked");
        const available = renderHook(() => useChatBackendModelOptions());
        expect(available.result.current.options.map((option) => option.value)).toEqual([
          "model-a",
          "model-keyless",
        ]);
      } finally {
        delete provider.apiKeyRef;
      }
    });

    it("lists enabled models whose provider can authenticate and resolves a legacy selection", () => {
      const { result } = renderHook(() => useChatBackendModelOptions(false));
      expect(result.current.options).toEqual([{ label: "GPT-4o", value: "model-a" }]);
      expect(result.current.resolveSelectionId("gpt-4o|openai")).toBe("model-a");
    });
    it("does not substitute the first model for a removed command selection", () => {
      const { result } = renderHook(() => useChatBackendModelOptions(false));
      expect(result.current.resolveSelectionId("removed")).toBeUndefined();
      expect(result.current.resolveSelectionId(undefined)).toBeUndefined();
    });
  });
});
