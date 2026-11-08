import {
  SCRIBE_FOLDER_ROOT,
  DEFAULT_QA_EXCLUSIONS_SETTING,
  DEFAULT_SETTINGS,
  SEND_SHORTCUT,
} from "@/constants";
import {
  resetSettings,
  sanitizeQaExclusions,
  sanitizeSettings,
  settingsAtom,
  settingsStore,
  ScribeSettings,
} from "@/settings/model";
import { CustomModel } from "@/aiParams";

describe("model", () => {
  describe("sanitizeQaExclusions", () => {
    it("defaults to scribe root when value is not a string", () => {
      expect(sanitizeQaExclusions(undefined)).toBe(
        encodeURIComponent(DEFAULT_QA_EXCLUSIONS_SETTING)
      );
    });

    it("keeps slash-only patterns distinct from canonical entries", () => {
      const rawValue = `${encodeURIComponent("///")},${encodeURIComponent(SCRIBE_FOLDER_ROOT)}`;

      const sanitized = sanitizeQaExclusions(rawValue);

      expect(sanitized.split(",")).toEqual([
        encodeURIComponent("///"),
        encodeURIComponent(SCRIBE_FOLDER_ROOT),
      ]);
    });

    it("normalizes trailing slashes to canonical path keys", () => {
      const rawValue = `${encodeURIComponent("folder/")},${encodeURIComponent("folder//")}`;

      const sanitized = sanitizeQaExclusions(rawValue);

      expect(sanitized.split(",")).toEqual([encodeURIComponent("folder/")]);
    });

    it("does not add the scribe root to a custom exclusion list (the system exclusion covers it)", () => {
      const rawValue = encodeURIComponent("folder");

      const sanitized = sanitizeQaExclusions(rawValue);

      expect(sanitized.split(",")).toEqual([encodeURIComponent("folder")]);
    });

    it("keeps a malformed percent sequence instead of failing settings load", () => {
      const sanitized = sanitizeQaExclusions("notes/100%");

      expect(sanitized.split(",")).toEqual([encodeURIComponent("notes/100%")]);
    });
  });

  describe("sanitizeSettings", () => {
    it.each([false, true])(
      "drops the retired CORS value %s while retaining provider credentials and configured models https://github.com/ItsDalk-Lane/Scribe/issues/51",
      (enableCors) => {
        const provider = {
          providerId: "saved-zhipu",
          providerType: "openai-compatible" as const,
          displayName: "Saved Zhipu",
          baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
          apiKeyRef: "encrypted-zhipu-key",
          requiresApiKey: true,
          origin: { kind: "byok" as const, catalogProviderId: "zhipuai-coding-plan" },
          addedAt: 1,
        };
        const input = {
          ...DEFAULT_SETTINGS,
          providers: { "saved-zhipu": { ...provider, enableCors } },
          configuredModels: [
            {
              configuredModelId: "saved-glm",
              providerId: "saved-zhipu",
              info: { id: "glm-5.3", displayName: "GLM-5.3" },
              configuredAt: 2,
            },
          ],
        };

        const sanitized = sanitizeSettings(input);

        expect(sanitized.providers["saved-zhipu"]).toEqual(provider);
        expect(sanitized.configuredModels).toEqual(input.configuredModels);
        expect(input.providers["saved-zhipu"].enableCors).toBe(enableCors);
      }
    );

    it("defaults missing child limits and retains explicitly configured limits https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
      const input = {
        ...DEFAULT_SETTINGS,
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          subagents: { maxConcurrent: 2, maxQueued: 0, maxTaskRequests: 200 },
        },
      };
      expect(sanitizeSettings(input).agentMode.subagents).toEqual({
        maxConcurrent: 2,
        maxQueued: 0,
        maxTaskRequests: 200,
      });
      expect(
        sanitizeSettings({
          ...input,
          agentMode: {
            ...input.agentMode,
            subagents: { maxConcurrent: -1, maxQueued: 1.5, maxTaskRequests: 0 },
          },
        }).agentMode.subagents
      ).toEqual({ maxConcurrent: 3, maxQueued: 20, maxTaskRequests: 100 });
      expect(
        sanitizeSettings({ ...input, agentMode: { ...input.agentMode, subagents: undefined } })
          .agentMode.subagents
      ).toEqual({ maxConcurrent: 3, maxQueued: 20, maxTaskRequests: 100 });
    });
    it("keeps valid subagent chat open areas and falls back to the right sidebar for invalid ones", () => {
      for (const area of ["left", "right", "floating"] as const) {
        expect(
          sanitizeSettings({
            ...DEFAULT_SETTINGS,
            agentMode: { ...DEFAULT_SETTINGS.agentMode, subagentChatOpenArea: area },
          }).agentMode.subagentChatOpenArea
        ).toBe(area);
      }
      expect(
        sanitizeSettings({
          ...DEFAULT_SETTINGS,
          agentMode: { ...DEFAULT_SETTINGS.agentMode, subagentChatOpenArea: "top" as never },
        }).agentMode.subagentChatOpenArea
      ).toBe("right");
      expect(
        sanitizeSettings({
          ...DEFAULT_SETTINGS,
          agentMode: { ...DEFAULT_SETTINGS.agentMode, subagentChatOpenArea: undefined },
        }).agentMode.subagentChatOpenArea
      ).toBe("right");
    });

    it("keeps only known built-in command names in the disabled list, without duplicates", () => {
      expect(
        sanitizeSettings({
          ...DEFAULT_SETTINGS,
          agentMode: {
            ...DEFAULT_SETTINGS.agentMode,
            disabledBuiltinCommands: ["compact", "compact", "unknown", 3 as never],
          },
        }).agentMode.disabledBuiltinCommands
      ).toEqual(["compact"]);
    });

    it("treats a missing or non-list disabled command setting as every built-in command being on", () => {
      for (const raw of [undefined, "compact"]) {
        expect(
          sanitizeSettings({
            ...DEFAULT_SETTINGS,
            agentMode: { ...DEFAULT_SETTINGS.agentMode, disabledBuiltinCommands: raw as never },
          }).agentMode.disabledBuiltinCommands
        ).toEqual([]);
      }
    });

    it("drops the retired skill list sort strategy from settings written by older versions https://github.com/ItsDalk-Lane/Scribe/issues/48", () => {
      const stored = {
        ...DEFAULT_SETTINGS,
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          skills: {
            ...DEFAULT_SETTINGS.agentMode.skills,
            sortStrategy: "recent",
          } as ScribeSettings["agentMode"]["skills"],
        },
      };
      const sanitized = sanitizeSettings(stored);
      expect(sanitized.agentMode.skills).not.toHaveProperty("sortStrategy");
    });

    it("keeps valid skill catalog budget overrides and falls back to defaults for invalid ones https://github.com/ItsDalk-Lane/Scribe/issues/40", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          skills: { catalogBudgetPercent: 5, catalogBudgetMaxTokens: 2000 },
        },
      });
      expect(sanitized.agentMode.skills.catalogBudgetPercent).toBe(5);
      expect(sanitized.agentMode.skills.catalogBudgetMaxTokens).toBe(2000);
      const invalid = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          skills: {
            catalogBudgetPercent: Number.NaN,
            catalogBudgetMaxTokens: -1,
          },
        },
      });
      expect(invalid.agentMode.skills.catalogBudgetPercent).toBe(
        DEFAULT_SETTINGS.agentMode.skills.catalogBudgetPercent
      );
      expect(invalid.agentMode.skills.catalogBudgetMaxTokens).toBe(
        DEFAULT_SETTINGS.agentMode.skills.catalogBudgetMaxTokens
      );
    });

    it("keeps missing limits unlimited, preserves an explicit 50 and accepts limits above 1000 https://github.com/ItsDalk-Lane/Scribe/issues/31", () => {
      for (const maxSteps of [undefined, 50, 1001]) {
        const sanitized = sanitizeSettings({
          ...DEFAULT_SETTINGS,
          agentMode: { ...DEFAULT_SETTINGS.agentMode, backends: { native: { maxSteps } } },
        });
        expect(sanitized.agentMode.backends.native?.maxSteps).toBe(maxSteps);
      }
    });

    it("preserves the native agent model, permission mode and step limit without changing BYOK connections", () => {
      const result = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          activeBackend: "native",
          backends: {
            native: {
              enabled: true,
              defaultModel: { baseModelId: "custom-model", effort: "high" },
              defaultMode: "plan",
              maxSteps: 75,
            },
          },
        },
        backends: {
          chat: { enabledModels: ["custom-model"] },
          native: { enabledModels: ["custom-model"] },
        },
      } as unknown as ScribeSettings);
      expect(result.agentMode.backends).toEqual({
        native: {
          enabled: true,
          defaultModel: { baseModelId: "custom-model", effort: "high" },
          defaultMode: "plan",
          maxSteps: 75,
        },
      });
      expect(result.backends).toEqual({
        chat: { enabledModels: ["custom-model"] },
        native: { enabledModels: ["custom-model"] },
      });
    });

    it("keeps a hand-configured full default mode so loading never silently downgrades it (https://github.com/ItsDalk-Lane/Scribe/issues/38)", () => {
      const result = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          backends: { native: { defaultMode: "full" } },
        },
      } as unknown as ScribeSettings);
      expect(result.agentMode.backends.native?.defaultMode).toBe("full");
    });

    it("drops invalid native model, permission mode, step limit and external runtime fields", () => {
      const result = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          backends: {
            native: {
              defaultModel: { baseModelId: "" },
              defaultMode: "unrestricted",
              maxSteps: -1,
              cliPath: "/external-agent",
              envOverrides: { SECRET: "not-native" },
            },
          },
        },
      } as unknown as ScribeSettings);
      expect(result.agentMode.backends).toEqual({
        native: { defaultModel: undefined, defaultMode: undefined, maxSteps: undefined },
      });
    });

    it.each([true, false])("preserves the agent enabled choice %s", (enabled) => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: { ...DEFAULT_SETTINGS.agentMode, backends: { native: { enabled } } },
      });
      expect(sanitized.agentMode.backends.native?.enabled).toBe(enabled);
    });

    it.each(["claude", "opencode", "codex"])(
      "keeps native settings and ignores retired runtime configuration when loading a %s default",
      (activeBackend) => {
        const sanitized = sanitizeSettings({
          ...DEFAULT_SETTINGS,
          agentMode: {
            ...DEFAULT_SETTINGS.agentMode,
            activeBackend,
            backends: {
              native: { defaultModel: { baseModelId: "selected-model", effort: "high" } },
              claude: { defaultModel: { baseModelId: "legacy-model", effort: null } },
              opencode: { binaryPath: "/legacy/opencode" },
              codex: { binaryPath: "/legacy/codex" },
            },
            deviceProfiles: {
              laptop: {
                claudeCliPath: "/bin/claude",
                claude: { envOverrides: { ANTHROPIC_BASE_URL: "https://example.com" } },
                opencode: { binaryPath: "/legacy/opencode" },
                codex: { binaryPath: "/legacy/codex" },
              },
            },
          },
        } as unknown as ScribeSettings);

        expect(sanitized.agentMode.activeBackend).toBe("native");
        expect(Object.keys(sanitized.agentMode.backends)).toEqual(["native"]);
        expect(sanitized.agentMode.backends.native?.defaultModel).toEqual({
          baseModelId: "selected-model",
          effort: "high",
        });
        expect("deviceProfiles" in sanitized.agentMode).toBe(false);
      }
    );

    it("removes retired agent models and references while preserving ordinary chat providers", () => {
      const provider = (providerId: string, origin: unknown) => ({
        providerId,
        providerType: "openai-compatible",
        displayName: providerId,
        origin,
        addedAt: 0,
      });
      const model = (configuredModelId: string, providerId: string) => ({
        configuredModelId,
        providerId,
        info: { id: configuredModelId, displayName: configuredModelId },
        configuredAt: 0,
      });
      const input = {
        ...DEFAULT_SETTINGS,
        providers: {
          claude: provider("claude", { kind: "agent", agentType: "claude" }),
          codex: provider("codex", { kind: "agent", agentType: "codex" }),
          opencode: provider("opencode", { kind: "agent", agentType: "opencode" }),
          "Codex BYOK": provider("Codex BYOK", { kind: "byok", catalogProviderId: "openai" }),
        },
        configuredModels: [
          model("sonnet", "claude"),
          model("codex-model", "codex"),
          model("opencode-model", "opencode"),
          model("gpt-5.2-codex", "Codex BYOK"),
        ],
        backends: {
          chat: { enabledModels: ["gpt-5.2-codex", "codex-model"] },
          claude: { enabledModels: ["sonnet"] },
          codex: { enabledModels: ["codex-model"] },
          opencode: { enabledModels: ["opencode-model"] },
        },
      } as unknown as ScribeSettings;

      const sanitized = sanitizeSettings(input);

      expect(Object.keys(sanitized.providers)).toEqual(["Codex BYOK"]);
      expect(sanitized.configuredModels.map((record) => record.configuredModelId)).toEqual([
        "gpt-5.2-codex",
      ]);
      expect(sanitized.backends).toEqual({
        chat: { enabledModels: ["gpt-5.2-codex"] },
      });
      expect(Object.keys(input.providers)).toHaveLength(4);
      expect(input.configuredModels).toHaveLength(4);
    });

    it("falls back to ENTER when defaultSendShortcut is missing", () => {
      const settingsWithoutShortcut = {
        ...DEFAULT_SETTINGS,
        defaultSendShortcut: undefined,
      } as unknown as ScribeSettings;

      const sanitized = sanitizeSettings(settingsWithoutShortcut);

      expect(sanitized.defaultSendShortcut).toBe(SEND_SHORTCUT.ENTER);
    });

    it("falls back to ENTER when defaultSendShortcut is unrecognized", () => {
      const settingsWithInvalidShortcut = {
        ...DEFAULT_SETTINGS,
        defaultSendShortcut: "invalid-shortcut",
      } as unknown as ScribeSettings;

      const sanitized = sanitizeSettings(settingsWithInvalidShortcut);

      expect(sanitized.defaultSendShortcut).toBe(SEND_SHORTCUT.ENTER);
    });

    it("keeps a saved ENTER send shortcut", () => {
      const settingsWithEnter = {
        ...DEFAULT_SETTINGS,
        defaultSendShortcut: SEND_SHORTCUT.ENTER,
      };

      const sanitized = sanitizeSettings(settingsWithEnter);

      expect(sanitized.defaultSendShortcut).toBe(SEND_SHORTCUT.ENTER);
    });

    it("keeps a saved SHIFT_ENTER send shortcut", () => {
      const settingsWithShiftEnter = {
        ...DEFAULT_SETTINGS,
        defaultSendShortcut: SEND_SHORTCUT.SHIFT_ENTER,
      };

      const sanitized = sanitizeSettings(settingsWithShiftEnter);

      expect(sanitized.defaultSendShortcut).toBe(SEND_SHORTCUT.SHIFT_ENTER);
    });

    it("creates a default agentMode slice when missing", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: undefined as unknown as never,
      });
      expect(sanitized.agentMode).toEqual({
        activeBackend: "native",
        disabledBuiltinCommands: [],
        subagents: { maxConcurrent: 3, maxQueued: 20, maxTaskRequests: 100 },
        backends: {},
        notificationSound: true,
        notificationSoundId: "piano",
        welcomeDismissed: false,
        subagentChatOpenArea: "right",
        skills: DEFAULT_SETTINGS.agentMode.skills,
      });
    });

    it("defaults notificationSound to on so an unattended turn still calls the user back", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          activeBackend: "native",
          backends: {},
        },
      } as unknown as ScribeSettings);
      expect(sanitized.agentMode.notificationSound).toBe(true);
    });

    it("keeps a chosen notification sound and drops one no longer in the catalog", () => {
      const chosen = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          activeBackend: "native",
          backends: {},
          notificationSoundId: "doorbell",
        },
      } as unknown as ScribeSettings);
      expect(chosen.agentMode.notificationSoundId).toBe("doorbell");

      const removed = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          activeBackend: "native",
          backends: {},
          notificationSoundId: "removed-sound",
        },
      } as unknown as ScribeSettings);
      expect(removed.agentMode.notificationSoundId).toBe(
        DEFAULT_SETTINGS.agentMode.notificationSoundId
      );
    });

    it("preserves an explicit notificationSound=false (a user who muted it stays muted)", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          activeBackend: "native",
          backends: {},
          notificationSound: false,
        },
      } as unknown as ScribeSettings);
      expect(sanitized.agentMode.notificationSound).toBe(false);
    });

    it("leaves backends empty when no legacy fields and no existing slice", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: { enabled: true },
      } as unknown as ScribeSettings);
      expect(sanitized.agentMode.backends).toEqual({});
    });

    it("defaults agentMode.welcomeDismissed to false when absent", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {} as unknown as ScribeSettings["agentMode"],
      });
      expect(sanitized.agentMode.welcomeDismissed).toBe(false);
    });

    it("carries a persisted agentMode.welcomeDismissed=true through sanitize", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          welcomeDismissed: true,
        } as unknown as ScribeSettings["agentMode"],
      });
      expect(sanitized.agentMode.welcomeDismissed).toBe(true);
    });

    it("ignores a non-boolean agentMode.welcomeDismissed, falling back to false", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          welcomeDismissed: "yes",
        } as unknown as ScribeSettings["agentMode"],
      });
      expect(sanitized.agentMode.welcomeDismissed).toBe(false);
    });

    it("loads old built-in preferences without retaining the removed feature or obsolete skill folder (https://github.com/ItsDalk-Lane/Scribe/issues/32)", () => {
      const result = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          skills: {
            folder: "scribe/skills",
            builtinPreferences: {
              "obsidian-markdown": { disabled: true, disabledAgents: ["opencode", 3] },
              invalid: null,
              malformedArray: [],
            },
          },
        },
      } as unknown as ScribeSettings);
      expect(result.agentMode.skills).not.toHaveProperty("builtinPreferences");
      expect(result.agentMode.skills).not.toHaveProperty("folder");
    });

    it("auto-attaches the active note for settings written before the field existed", () => {
      const withoutField = { ...DEFAULT_SETTINGS } as unknown as Record<string, unknown>;
      delete withoutField.autoAttachActiveNote;

      const sanitized = sanitizeSettings(withoutField as unknown as ScribeSettings);

      expect(sanitized.autoAttachActiveNote).toBe(true);
    });

    it("preserves a persisted choice to stop auto-attaching the active note", () => {
      const sanitized = sanitizeSettings({ ...DEFAULT_SETTINGS, autoAttachActiveNote: false });

      expect(sanitized.autoAttachActiveNote).toBe(false);
    });

    it("drops a persisted global output cap so it cannot truncate answers again", () => {
      const withRetiredCap = {
        ...DEFAULT_SETTINGS,
        maxTokens: 6000,
        quickCommandIncludeNoteContext: false,
      } as unknown as ScribeSettings;

      const sanitized = sanitizeSettings(withRetiredCap);

      expect("maxTokens" in (sanitized as unknown as Record<string, unknown>)).toBe(false);
      expect(sanitized.quickCommandIncludeNoteContext).toBe(false);
    });

    it("does not introduce retired chat preferences into fresh settings", () => {
      const sanitized = sanitizeSettings({ ...DEFAULT_SETTINGS });

      for (const field of [
        "contextTurns",
        "chatNoteContextPath",
        "chatNoteContextTags",
        "enableRecentConversations",
        "maxRecentConversations",
        "enableSavedMemory",
        "autoCompactThreshold",
        "stream",
        "passMarkdownImages",
        "suggestedDefaultCommands",
        "reasoningEffort",
        "verbosity",
        "autoAcceptEdits",
      ]) {
        expect(DEFAULT_SETTINGS).not.toHaveProperty(field);
        expect(sanitized).not.toHaveProperty(field);
      }
    });

    it("preserves previously stored chat preferences as opaque data without changing their values", () => {
      const storedFields = {
        contextTurns: "old-context-window",
        chatNoteContextPath: "Past context",
        chatNoteContextTags: ["past-context"],
        enableRecentConversations: "old-choice",
        maxRecentConversations: 7,
        enableSavedMemory: "old-choice",
        autoCompactThreshold: 123,
        stream: "old-choice",
        passMarkdownImages: "old-choice",
        suggestedDefaultCommands: "old-choice",
        reasoningEffort: "old-choice",
        verbosity: "old-choice",
        autoAcceptEdits: "old-choice",
      };
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        ...storedFields,
      });

      expect(sanitized).toMatchObject(storedFields);
    });

    it("uses only the fixed hidden folder and ignores old folder settings and history", () => {
      for (const folder of ["scribe", "team/ai", ".scribe", "../escape", ""]) {
        const settings = sanitizeSettings({
          ...DEFAULT_SETTINGS,
          scribeFolder: folder,
          scribeRootHistory: ["old-folder"],
        });
        expect(settings.scribeFolder).toBe(".scribe");
        expect(settings.scribeRootHistory).toEqual([]);
      }
    });
  });

  describe("resetSettings", () => {
    it("restores the fixed data root without retaining old directory history", () => {
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        scribeFolder: "team-ai",
        scribeRootHistory: ["scribe", "ai"],
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.scribeFolder).toBe(DEFAULT_SETTINGS.scribeFolder);
      expect(after.scribeRootHistory).toEqual([]);
    });

    it("preserves every custom model, including rows that carry no key", () => {
      const withKey: CustomModel = {
        name: "my-llama",
        provider: "openai",
        enabled: true,
        apiKey: "sk-custom",
        baseUrl: "http://localhost:1234",
      };
      const withoutKey: CustomModel = {
        name: "ollama-llama",
        provider: "ollama",
        enabled: true,
      };
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        activeModels: [withKey, withoutKey],
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      const myLlama = after.activeModels.find((m) => m.name === "my-llama");
      expect(myLlama?.apiKey).toBe("sk-custom");
      expect(myLlama?.baseUrl).toBe("http://localhost:1234");
      expect(after.activeModels.find((m) => m.name === "ollama-llama")).toBeDefined();
    });

    it("filters out null/undefined top-level secrets", () => {
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        openAIApiKey: "valid-key",
        anthropicApiKey: null as unknown as string,
        googleApiKey: undefined as unknown as string,
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.openAIApiKey).toBe("valid-key");
      expect(after.anthropicApiKey).toBe(DEFAULT_SETTINGS.anthropicApiKey);
      expect(after.googleApiKey).toBe(DEFAULT_SETTINGS.googleApiKey);
    });

    it("preserves the top-level vendor config a retained key needs to reach its service", () => {
      const vendorConfig = {
        openAIOrgId: "org-123",
        azureOpenAIApiInstanceName: "my-instance",
        azureOpenAIApiDeploymentName: "chat-deploy",
        azureOpenAIApiVersion: "2025-01-01-preview",
      };
      settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, ...vendorConfig });

      resetSettings();

      expect(settingsStore.get(settingsAtom)).toMatchObject(vendorConfig);
    });

    it("drops a bundle value whose type its consumer cannot handle", () => {
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        openAIApiKey: "sk-openai",
        openAIOrgId: {} as unknown as string,
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.openAIApiKey).toBe("sk-openai");
      expect(after.openAIOrgId).toBe(DEFAULT_SETTINGS.openAIOrgId);
    });

    it("preserves configured models belonging to preserved providers", () => {
      const providerId1 = "prov-with-key";
      const providerId2 = "prov-no-key";
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        providers: {
          [providerId1]: {
            providerId: providerId1,
            providerType: "openai-compatible",
            displayName: "Provider With Key",
            apiKeyRef: "kc-123",
            origin: { kind: "byok" },
            addedAt: Date.now(),
          },
          [providerId2]: {
            providerId: providerId2,
            providerType: "openai-compatible",
            displayName: "Provider No Key (Ollama)",
            origin: { kind: "byok" },
            addedAt: Date.now(),
          },
        },
        configuredModels: [
          {
            configuredModelId: "model-1",
            providerId: providerId1,
            info: { id: "gpt-4", displayName: "GPT-4" },
            configuredAt: Date.now(),
          },
          {
            configuredModelId: "model-2",
            providerId: providerId2,
            info: { id: "llama3", displayName: "Llama 3" },
            configuredAt: Date.now(),
          },
        ],
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.providers[providerId1]).toBeDefined();
      expect(after.providers[providerId1].apiKeyRef).toBe("kc-123");
      expect(after.providers[providerId2]).toBeUndefined();
      expect(after.configuredModels.length).toBe(1);
      expect(after.configuredModels[0].configuredModelId).toBe("model-1");
      expect(after.configuredModels[0].providerId).toBe(providerId1);
    });

    it("clears backends regardless of preserved providers", () => {
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        providers: {
          prov1: {
            providerId: "prov1",
            providerType: "openai-compatible",
            displayName: "Provider",
            apiKeyRef: "kc-123",
            origin: { kind: "byok" },
            addedAt: Date.now(),
          },
        },
        backends: {
          chat: { enabledModels: ["model-1", "model-2"] },
          native: { enabledModels: ["model-3"] },
        },
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.providers.prov1).toBeDefined();
      expect(after.backends).toEqual(DEFAULT_SETTINGS.backends);
    });
  });
});
