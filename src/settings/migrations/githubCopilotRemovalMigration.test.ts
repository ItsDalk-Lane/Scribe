import type { CustomModel } from "@/aiParams";
import { ChatModelProviders, DEFAULT_SETTINGS } from "@/constants";
import { type ScribeSettings, setSettings } from "@/settings/model";

import {
  executeRetiredModelsAndSelectionsRemoval,
  planRetiredModelsAndSelectionsRemoval,
} from "./githubCopilotRemovalMigration";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/settings/model", () => {
  const actual = jest.requireActual<typeof import("@/settings/model")>("@/settings/model");
  return { ...actual, setSettings: jest.fn() };
});

const mockSetSettings = setSettings as jest.MockedFunction<typeof setSettings>;

function model(overrides: Partial<CustomModel>): CustomModel {
  return {
    name: "test-model",
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    ...overrides,
  };
}

function settingsWith(overrides: Partial<ScribeSettings> = {}): ScribeSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("githubCopilotRemovalMigration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("planRetiredModelsAndSelectionsRemoval()", () => {
    it("returns null for a vault that never configured GitHub Copilot", () => {
      expect(
        planRetiredModelsAndSelectionsRemoval(
          settingsWith({
            activeModels: [model({ name: "gpt-4o" })],
            defaultModelKey: "gpt-4o|openai",
          })
        )
      ).toBeNull();
    });

    it("drops every GitHub Copilot model and keeps the rest in order", () => {
      const patch = planRetiredModelsAndSelectionsRemoval(
        settingsWith({
          activeModels: [
            model({ name: "gpt-4o", provider: "github-copilot" }),
            model({ name: "claude-sonnet-4-5", provider: ChatModelProviders.ANTHROPIC }),
            model({ name: "gpt-5-codex", provider: "github-copilot", enabled: false }),
            model({ name: "gpt-4o", provider: ChatModelProviders.OPENAI }),
          ],
        })
      );

      expect(patch?.activeModels).toEqual([
        model({ name: "claude-sonnet-4-5", provider: ChatModelProviders.ANTHROPIC }),
        model({ name: "gpt-4o", provider: ChatModelProviders.OPENAI }),
      ]);
      expect(patch).not.toHaveProperty("defaultModelKey");
    });

    it("clears a default model key that pointed at a GitHub Copilot model", () => {
      expect(
        planRetiredModelsAndSelectionsRemoval(
          settingsWith({ defaultModelKey: "gpt-4o|github-copilot" })
        )
      ).toEqual({ defaultModelKey: "" });
    });

    it("clears a backend-prefixed default model key that pointed at a GitHub Copilot model", () => {
      expect(
        planRetiredModelsAndSelectionsRemoval(
          settingsWith({ defaultModelKey: "opencode:gpt-4o|github-copilot" })
        )
      ).toEqual({ defaultModelKey: "" });
    });

    it("clears the quick command selection to undefined so quick ask inherits the chat default again", () => {
      const patch = planRetiredModelsAndSelectionsRemoval(
        settingsWith({ quickCommandModelKey: "gpt-4o|github-copilot" })
      );

      expect(patch).toEqual({ quickCommandModelKey: undefined });
      expect(patch).toHaveProperty("quickCommandModelKey");
    });

    it("leaves a quick command selection that points at a surviving model alone", () => {
      expect(
        planRetiredModelsAndSelectionsRemoval(
          settingsWith({ quickCommandModelKey: "gpt-4o|openai" })
        )
      ).toBeNull();
    });

    it("tolerates settings that predate the model list", () => {
      const bare = settingsWith();
      delete (bare as Partial<ScribeSettings>).activeModels;

      expect(planRetiredModelsAndSelectionsRemoval(bare)).toBeNull();
    });

    it("does not treat a provider whose name merely contains the removed one as removed", () => {
      expect(
        planRetiredModelsAndSelectionsRemoval(
          settingsWith({
            activeModels: [model({ name: "gpt-4o", provider: "my-github-copilot-proxy" })],
            defaultModelKey: "gpt-4o|my-github-copilot-proxy",
          })
        )
      ).toBeNull();
    });
  });

  describe("executeRetiredModelsAndSelectionsRemoval()", () => {
    it("applies the removal plan for retired models and selections", () => {
      executeRetiredModelsAndSelectionsRemoval(
        settingsWith({
          activeModels: [model({ name: "gpt-4o", provider: "github-copilot" })],
          defaultModelKey: "gpt-4o|github-copilot",
        })
      );

      expect(mockSetSettings).toHaveBeenCalledWith({ activeModels: [], defaultModelKey: "" });
    });

    it("does not change settings when no models or selections match", () => {
      executeRetiredModelsAndSelectionsRemoval(settingsWith());

      expect(mockSetSettings).not.toHaveBeenCalled();
    });
  });
});
