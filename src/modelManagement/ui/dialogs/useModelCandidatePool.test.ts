import { act, renderHook } from "@testing-library/react";
import { listProviderModels } from "@/modelManagement/providers/adapters/listProviderModels";
import type { ListModelsResult } from "@/modelManagement/providers/adapters/listModelsHttp";
import { useModelCandidatePool, type UseModelCandidatePoolArgs } from "./useModelCandidatePool";

jest.mock("@/modelManagement/providers/adapters/listProviderModels", () => ({
  listProviderModels: jest.fn(),
}));

const listModels = jest.mocked(listProviderModels);
const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/1";

function args(overrides: Partial<UseModelCandidatePoolArgs> = {}): UseModelCandidatePoolArgs {
  return {
    mode: "new",
    providerType: "openai-compatible",
    effectiveBaseUrl: "",
    existingModels: [],
    catalogMetadata: {},
    apiKey: "",
    extras: {},
    requiresApiKey: false,
    providerHydrated: true,
    ...overrides,
  };
}

describe("useModelCandidatePool", () => {
  describe("useModelCandidatePool", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      listModels.mockResolvedValue({ ok: true, modelIds: [] });
    });

    it(`offers catalog candidates with their capabilities even without a model-list endpoint (${issue})`, () => {
      const info = {
        id: "reasoner",
        displayName: "Reasoner",
        reasoning: true,
        limits: { context: 123456 },
      };
      const { result } = renderHook(() =>
        useModelCandidatePool(args({ catalogMetadata: { reasoner: info } }))
      );
      expect(result.current.availableModels).toEqual([info]);
      expect(listModels).not.toHaveBeenCalled();
    });

    it(`retains saved model capabilities when the catalog supplies only a new label (${issue})`, () => {
      const { result } = renderHook(() =>
        useModelCandidatePool(
          args({
            mode: "edit",
            existingModels: [
              {
                configuredModelId: "cm",
                providerId: "p",
                configuredAt: 0,
                info: {
                  id: "model",
                  displayName: "Saved",
                  toolCall: true,
                  limits: { context: 123456 },
                },
              },
            ],
            catalogMetadata: { model: { id: "model", displayName: "Catalog label" } },
          })
        )
      );
      expect(result.current.buildSelectedModelInfos()).toEqual([
        { id: "model", displayName: "Catalog label", toolCall: true, limits: { context: 123456 } },
      ]);
    });

    it(`automatically discovers a known endpoint after its required parameters become ready (${issue})`, async () => {
      const { rerender } = renderHook(
        (input: UseModelCandidatePoolArgs) => useModelCandidatePool(input),
        { initialProps: args({ autoDiscover: true, providerHydrated: false }) }
      );
      rerender(
        args({
          autoDiscover: true,
          providerHydrated: true,
          effectiveBaseUrl: "https://ready.example/v1",
        })
      );
      await act(async () => {
        await listModels.mock.results[0].value;
      });
      expect(listModels).toHaveBeenCalledTimes(1);
      expect(listModels).toHaveBeenCalledWith("openai-compatible", "https://ready.example/v1", {
        apiKey: null,
        extras: {},
      });
    });

    it(`uses the current empty key after clearing credentials (${issue})`, async () => {
      const { result, rerender } = renderHook(
        (input: UseModelCandidatePoolArgs) => useModelCandidatePool(input),
        { initialProps: args({ mode: "edit", providerHydrated: false }) }
      );
      rerender(
        args({
          mode: "edit",
          providerHydrated: false,
          effectiveBaseUrl: "https://new.example/v1",
        })
      );
      await act(() => result.current.fetchModels());
      expect(listModels).toHaveBeenCalledWith("openai-compatible", "https://new.example/v1", {
        apiKey: null,
        extras: {},
      });
    });

    it(`discards an old endpoint's late response while retaining selected and hand-entered models (${issue})`, async () => {
      let finish!: (result: ListModelsResult) => void;
      listModels.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const { result, rerender } = renderHook(
        (input: UseModelCandidatePoolArgs) => useModelCandidatePool(input),
        { initialProps: args() }
      );
      rerender(args({ effectiveBaseUrl: "https://old.example/v1" }));
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.fetchModels();
        result.current.addId("my-model");
      });
      rerender(args({ effectiveBaseUrl: "https://new.example/v1" }));
      await act(async () => {
        finish({ ok: true, modelIds: ["old-endpoint-model"] });
        await pending;
      });
      expect(result.current.availableModels.map((model) => model.id)).toEqual(["my-model"]);
      expect(result.current.selectedWireIds.has("my-model")).toBe(true);
      expect(result.current.fetching).toBe(false);
    });

    it(`keeps the latest request busy when an older request finishes first (${issue})`, async () => {
      let finishOld!: (result: ListModelsResult) => void;
      let finishNew!: (result: ListModelsResult) => void;
      listModels
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishOld = resolve;
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishNew = resolve;
            })
        );
      const { result, rerender } = renderHook(
        (input: UseModelCandidatePoolArgs) => useModelCandidatePool(input),
        { initialProps: args() }
      );
      rerender(args({ effectiveBaseUrl: "https://old.example/v1" }));
      let oldRequest!: Promise<void>;
      let newRequest!: Promise<void>;
      act(() => {
        oldRequest = result.current.fetchModels();
      });
      rerender(args({ effectiveBaseUrl: "https://new.example/v1" }));
      act(() => {
        newRequest = result.current.fetchModels();
      });
      await act(async () => {
        finishOld({ ok: false, message: "Old failure" });
        await oldRequest;
      });
      expect(result.current.fetching).toBe(true);
      expect(result.current.fetchError).toBeNull();
      await act(async () => {
        finishNew({ ok: true, modelIds: ["current-model"] });
        await newRequest;
      });
      expect(result.current.availableModels.map((model) => model.id)).toEqual(["current-model"]);
    });

    it(`drops old discovered candidates when parameters change but preserves their selected model metadata (${issue})`, async () => {
      const { result, rerender } = renderHook(
        (input: UseModelCandidatePoolArgs) => useModelCandidatePool(input),
        { initialProps: args() }
      );
      rerender(
        args({
          effectiveBaseUrl: "https://api.example/v1",
          extras: { region: "first" },
          catalogMetadata: { kept: { id: "kept", displayName: "Kept", reasoning: true } },
        })
      );
      listModels.mockResolvedValueOnce({ ok: true, modelIds: ["kept", "old-model"] });
      await act(() => result.current.fetchModels());
      act(() => result.current.toggle("kept", true));
      rerender(
        args({
          effectiveBaseUrl: "https://api.example/v1",
          extras: { region: "second" },
          catalogMetadata: { kept: { id: "kept", displayName: "Kept", reasoning: true } },
        })
      );
      expect(result.current.availableModels.map((model) => model.id)).toEqual(["kept"]);
      expect(result.current.buildSelectedModelInfos()).toEqual([
        { id: "kept", displayName: "Kept", reasoning: true },
      ]);
    });

    it(`removes a hand-entered model from selection and candidates without removing other saved models (${issue})`, () => {
      const { result } = renderHook(() => useModelCandidatePool(args()));
      act(() => {
        result.current.addId("first");
        result.current.addId("second");
      });
      act(() => result.current.removeId("first"));
      expect(result.current.buildSelectedModelInfos().map((model) => model.id)).toEqual(["second"]);
      expect(result.current.availableModels.map((model) => model.id)).toEqual(["second"]);
    });
  });
});
