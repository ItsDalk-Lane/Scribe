import type { BackendState, EnabledModelEntry } from "@/agentMode/session/types";
import { noEnabledModelError, pickEnabledModel } from "./enabledModelSelection";

const USER_MODEL = "openai/gpt-4.1";
const STEP_FLASH = "openrouter/stepfun/step-3.5-flash";
const BIG_PICKLE = "opencode/big-pickle";

function enabled(baseModelId: string, credentialState: "ok" | "missing_key" = "ok") {
  return { baseModelId, name: baseModelId, credentialState } satisfies EnabledModelEntry;
}

function catalog(modelIds: string[]): BackendState["model"] {
  return {
    current: { baseModelId: BIG_PICKLE, effort: null },
    apply: { kind: "setConfigOption", configId: "model" },
    availableModels: modelIds.map((baseModelId) => ({
      baseModelId,
      name: baseModelId,
      provider: null,
      effortOptions: [],
    })),
  };
}

describe("enabledModelSelection", () => {
  describe("pickEnabledModel()", () => {
    it("settles on the seed once the catalog offers it", () => {
      const seed = { baseModelId: USER_MODEL, effort: "low" };

      expect(
        pickEnabledModel([enabled(USER_MODEL)], catalog([BIG_PICKLE, USER_MODEL]), seed)
      ).toEqual({ target: seed, settled: true });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 stays unsettled, offering an enabled fallback, while a runnable seed is missing from the catalog", () => {
      expect(
        pickEnabledModel(
          [enabled(USER_MODEL), enabled(STEP_FLASH)],
          catalog([BIG_PICKLE, STEP_FLASH]),
          { baseModelId: USER_MODEL, effort: null }
        )
      ).toEqual({ target: { baseModelId: STEP_FLASH, effort: null }, settled: false });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 stays unsettled with no target when the seed cannot run and no enabled model is offered yet", () => {
      expect(
        pickEnabledModel([enabled(STEP_FLASH)], catalog([BIG_PICKLE]), {
          baseModelId: BIG_PICKLE,
          effort: null,
        })
      ).toEqual({ target: null, settled: false });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 settles on the first offered enabled model when the seed's provider key is missing", () => {
      expect(
        pickEnabledModel(
          [enabled(USER_MODEL, "missing_key"), enabled(STEP_FLASH)],
          catalog([USER_MODEL, STEP_FLASH]),
          { baseModelId: USER_MODEL, effort: null }
        )
      ).toEqual({ target: { baseModelId: STEP_FLASH, effort: null }, settled: true });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 settles with no target at once when no enabled model can run", () => {
      expect(
        pickEnabledModel([enabled(USER_MODEL, "missing_key")], catalog([USER_MODEL]), null)
      ).toEqual({ target: null, settled: true });
    });
  });

  describe("noEnabledModelError()", () => {
    it("names the agent and points the user to Scribe's model settings", () => {
      expect(noEnabledModelError("opencode").message).toBe(
        "None of the models enabled for opencode are available. Check them in Scribe's model settings."
      );
    });
  });
});
