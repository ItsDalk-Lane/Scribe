import {
  SCRIBE_FOLDER_ROOT,
  DEFAULT_QA_EXCLUSIONS_SETTING,
  DEFAULT_SETTINGS,
  SEND_SHORTCUT,
} from "@/constants";
import {
  normalizeRootFolders,
  resetSettings,
  sanitizeQaExclusions,
  sanitizeSettings,
  settingsAtom,
  settingsStore,
  toVisibleScribeFolder,
  validateScribeFolder,
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
        byok: {},
        activeBackend: "native",
        backends: {},
        debugFullFrames: true,
        notificationSound: true,
        notificationSoundId: "piano",
        welcomeDismissed: false,
        skills: {
          folder: "scribe/skills",
        },
      });
    });

    it("defaults notificationSound to on so an unattended turn still calls the user back", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          byok: {},
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
          byok: {},
          activeBackend: "native",
          backends: {},
          notificationSoundId: "doorbell",
        },
      } as unknown as ScribeSettings);
      expect(chosen.agentMode.notificationSoundId).toBe("doorbell");

      const removed = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          byok: {},
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
          byok: {},
          activeBackend: "native",
          backends: {},
          notificationSound: false,
        },
      } as unknown as ScribeSettings);
      expect(sanitized.agentMode.notificationSound).toBe(false);
    });

    it("preserves an explicit debugFullFrames=false (a user who turned it off stays off)", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          byok: {},
          activeBackend: "native",
          backends: {},
          debugFullFrames: false,
        },
      } as unknown as ScribeSettings);
      expect(sanitized.agentMode.debugFullFrames).toBe(false);
    });

    it("falls back to debugFullFrames=true when the persisted value is not a boolean", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          byok: {},
          activeBackend: "native",
          backends: {},
          debugFullFrames: "yes" as unknown as boolean,
        },
      } as unknown as ScribeSettings);
      expect(sanitized.agentMode.debugFullFrames).toBe(true);
    });

    it("leaves backends empty when no legacy fields and no existing slice", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: { enabled: true, byok: {} },
      } as unknown as ScribeSettings);
      expect(sanitized.agentMode.backends).toEqual({});
    });

    it("defaults agentMode.welcomeDismissed to false when absent", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: { byok: {} } as unknown as ScribeSettings["agentMode"],
      });
      expect(sanitized.agentMode.welcomeDismissed).toBe(false);
    });

    it("carries a persisted agentMode.welcomeDismissed=true through sanitize", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          byok: {},
          welcomeDismissed: true,
        } as unknown as ScribeSettings["agentMode"],
      });
      expect(sanitized.agentMode.welcomeDismissed).toBe(true);
    });

    it("ignores a non-boolean agentMode.welcomeDismissed, falling back to false", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          byok: {},
          welcomeDismissed: "yes",
        } as unknown as ScribeSettings["agentMode"],
      });
      expect(sanitized.agentMode.welcomeDismissed).toBe(false);
    });

    it("loads old built-in preferences without retaining the removed feature and keeps the skill folder (https://github.com/ItsDalk-Lane/Scribe/issues/32)", () => {
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
      expect(result.agentMode.skills.folder).toBe("scribe/skills");
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

    it("falls back to the default scribeFolder when it is whitespace-only", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        scribeFolder: "   ",
      });
      expect(out.scribeFolder).toBe(DEFAULT_SETTINGS.scribeFolder);
    });

    it("trims surrounding whitespace from a custom scribeFolder", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        scribeFolder: "  my-ai  ",
      });
      expect(out.scribeFolder).toBe("my-ai");
    });

    it("keeps a nested custom scribeFolder", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        scribeFolder: "notes/ai",
      });
      expect(out.scribeFolder).toBe("notes/ai");
    });

    it("loads a hidden scribeFolder as its visible name so every feature can index it", () => {
      for (const [hidden, visible] of [
        [".scribe", "scribe"],
        ["notes/.ai/", "notes/ai"],
      ]) {
        const out = sanitizeSettings({ ...DEFAULT_SETTINGS, scribeFolder: hidden });
        expect(out.scribeFolder).toBe(visible);
        expect(out.scribeRootHistory).toContain(visible);
      }
    });

    it("unions the active root into a normalized, deduped scribeRootHistory", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        scribeFolder: "team-ai",
        scribeRootHistory: ["scribe", "ai", "scribe"],
      });
      expect(new Set(out.scribeRootHistory)).toEqual(new Set(["scribe", "ai", "team-ai"]));
    });

    it("adds the active root to scribeRootHistory even when the history is missing", () => {
      const raw = { ...DEFAULT_SETTINGS, scribeFolder: "ai" } as unknown as Record<string, unknown>;
      delete raw.scribeRootHistory;
      const out = sanitizeSettings(raw as unknown as ScribeSettings);
      expect(out.scribeRootHistory).toContain("ai");
    });

    it("falls back to the default scribeFolder for every path validateScribeFolder rejects and keeps a valid nested folder", () => {
      for (const value of ["../escape", "/etc/passwd", "C:/x", "", "NUL", "scribe."]) {
        const out = sanitizeSettings({ ...DEFAULT_SETTINGS, scribeFolder: value });
        expect(out.scribeFolder).toBe(DEFAULT_SETTINGS.scribeFolder);
      }
      const kept = sanitizeSettings({ ...DEFAULT_SETTINGS, scribeFolder: "team/ai" });
      expect(kept.scribeFolder).toBe("team/ai");
    });
  });

  describe("validateScribeFolder", () => {
    it("rejects empty and whitespace-only values", () => {
      expect(validateScribeFolder("").ok).toBe(false);
      expect(validateScribeFolder("   ").ok).toBe(false);
    });

    it("accepts a simple relative folder and trims it", () => {
      expect(validateScribeFolder("  my-ai  ")).toEqual({ ok: true, folder: "my-ai" });
    });

    it("accepts a nested relative folder and strips a trailing slash", () => {
      expect(validateScribeFolder("notes/ai/")).toEqual({ ok: true, folder: "notes/ai" });
    });

    it("rejects parent-traversal, absolute, and drive-letter paths", () => {
      expect(validateScribeFolder("../escape").ok).toBe(false);
      expect(validateScribeFolder("a/../b").ok).toBe(false);
      expect(validateScribeFolder("/etc/passwd").ok).toBe(false);
      expect(validateScribeFolder("C:/Users/evil").ok).toBe(false);
    });

    it("rejects any segment that starts with a dot, because Obsidian does not index hidden folders", () => {
      expect(validateScribeFolder(".scribe")).toEqual({
        ok: false,
        reason: "Folder names cannot start with a dot.",
      });
      expect(validateScribeFolder("notes/.ai").ok).toBe(false);
      expect(validateScribeFolder("a/./b").ok).toBe(false);
      expect(validateScribeFolder("notes.ai/scribe").ok).toBe(true);
    });

    it("rejects roots that overlap the active config folder at a segment boundary", () => {
      const configDir = ".vault-config";
      expect(validateScribeFolder(configDir, configDir).ok).toBe(false);
      expect(validateScribeFolder(`${configDir.toUpperCase()}/plugins`, configDir).ok).toBe(false);
      expect(validateScribeFolder("scribe", "scribe/system-prompts").ok).toBe(false);
      expect(validateScribeFolder("scribe-data", "scribe/system-prompts").ok).toBe(true);
    });

    it("rejects Windows-illegal characters in any segment", () => {
      expect(validateScribeFolder("a/b<c").ok).toBe(false);
      expect(validateScribeFolder('a/b"c').ok).toBe(false);
      expect(validateScribeFolder("a/b|c").ok).toBe(false);
    });

    it("rejects Windows-reserved device names in any segment, any case, with or without extension", () => {
      expect(validateScribeFolder("NUL").ok).toBe(false);
      expect(validateScribeFolder("team/CON").ok).toBe(false);
      expect(validateScribeFolder("con.md").ok).toBe(false);
      expect(validateScribeFolder("Com1").ok).toBe(false);
      expect(validateScribeFolder("console").ok).toBe(true);
      expect(validateScribeFolder("nul-notes").ok).toBe(true);
    });

    it("rejects segments ending with a dot or space on every platform", () => {
      expect(validateScribeFolder("scribe.").ok).toBe(false);
      expect(validateScribeFolder("team /ai").ok).toBe(false);
      expect(validateScribeFolder("team./ai").ok).toBe(false);
    });
  });

  describe("toVisibleScribeFolder", () => {
    it("drops the leading dots of every segment and keeps visible paths unchanged", () => {
      expect(toVisibleScribeFolder(" .scribe ")).toBe("scribe");
      expect(toVisibleScribeFolder("..a\\.b/c.d")).toBe("a\\b/c.d");
      expect(toVisibleScribeFolder("notes/ai")).toBe("notes/ai");
    });

    it("turns traversal segments into empty segments that validation still rejects", () => {
      expect(validateScribeFolder(toVisibleScribeFolder("../escape")).ok).toBe(false);
      expect(validateScribeFolder(toVisibleScribeFolder("a/../b")).ok).toBe(false);
    });
  });

  describe("normalizeRootFolders", () => {
    it("preserves case and strips trailing slashes without lowercasing", () => {
      expect(normalizeRootFolders(["Scribe/", "ai//"])).toEqual(["Scribe", "ai"]);
    });

    it("dedupes case-sensitively, preserving first-seen order", () => {
      expect(normalizeRootFolders(["scribe", "ai", "scribe", "Scribe"])).toEqual([
        "scribe",
        "ai",
        "Scribe",
      ]);
    });

    it("drops empty, non-string, and vault-escaping entries", () => {
      expect(
        normalizeRootFolders([
          "",
          "   ",
          undefined,
          "../escape",
          "a/../b",
          "/etc",
          "C:\\Users\\Josh",
          "notes/ai",
        ])
      ).toEqual(["notes/ai"]);
    });

    it("collapses interior duplicate slashes into the matcher's canonical form", () => {
      expect(normalizeRootFolders(["a//b"])).toEqual(["a/b"]);
    });

    it("strips interior single-dot segments into the matcher's canonical form", () => {
      expect(normalizeRootFolders(["a/./b"])).toEqual(["a/b"]);
    });

    it("canonicalizes before deduping and traversal filtering", () => {
      expect(normalizeRootFolders(["a//b", "a/./b", "x/../y", "a/b"])).toEqual(["a/b"]);
    });
  });

  describe("resetSettings", () => {
    it("preserves historical roots and folds in the pre-reset active root", () => {
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        scribeFolder: "team-ai",
        scribeRootHistory: ["scribe", "ai"],
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.scribeFolder).toBe(DEFAULT_SETTINGS.scribeFolder);
      expect(new Set(after.scribeRootHistory)).toEqual(new Set(["scribe", "ai", "team-ai"]));
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
            apiKeyKeychainId: "kc-123",
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
      expect(after.providers[providerId1].apiKeyKeychainId).toBe("kc-123");
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
            apiKeyKeychainId: "kc-123",
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
