import {
  COPILOT_FOLDER_ROOT,
  DEFAULT_QA_EXCLUSIONS_SETTING,
  DEFAULT_SETTINGS,
  SEND_SHORTCUT,
} from "@/constants";
import {
  normalizeRootFolders,
  resetSettings,
  sanitizeEnvOverrides,
  sanitizeBuiltinPreferences,
  sanitizeQaExclusions,
  sanitizeSettings,
  settingsAtom,
  settingsStore,
  toVisibleCopilotFolder,
  validateCopilotFolder,
  CopilotSettings,
} from "@/settings/model";
import { CustomModel } from "@/aiParams";

function sanitizeClaudeSlice(autoModePermission: unknown): CopilotSettings {
  return sanitizeSettings({
    ...DEFAULT_SETTINGS,
    agentMode: {
      enabled: true,
      byok: {},
      activeBackend: "claude",
      backends: { claude: { autoModePermission } },
    },
  } as unknown as CopilotSettings);
}

describe("model", () => {
  describe("sanitizeQaExclusions()", () => {
    it("defaults to copilot root when value is not a string", () => {
      expect(sanitizeQaExclusions(undefined)).toBe(
        encodeURIComponent(DEFAULT_QA_EXCLUSIONS_SETTING)
      );
    });

    it("keeps slash-only patterns distinct from canonical entries", () => {
      const rawValue = `${encodeURIComponent("///")},${encodeURIComponent(COPILOT_FOLDER_ROOT)}`;

      const sanitized = sanitizeQaExclusions(rawValue);

      expect(sanitized.split(",")).toEqual([
        encodeURIComponent("///"),
        encodeURIComponent(COPILOT_FOLDER_ROOT),
      ]);
    });

    it("normalizes trailing slashes to canonical path keys", () => {
      const rawValue = `${encodeURIComponent("folder/")},${encodeURIComponent("folder//")}`;

      const sanitized = sanitizeQaExclusions(rawValue);

      expect(sanitized.split(",")).toEqual([encodeURIComponent("folder/")]);
    });

    it("does not add the copilot root to a custom exclusion list (the system exclusion covers it)", () => {
      const rawValue = encodeURIComponent("folder");

      const sanitized = sanitizeQaExclusions(rawValue);

      expect(sanitized.split(",")).toEqual([encodeURIComponent("folder")]);
    });

    it("keeps a malformed percent sequence instead of failing settings load", () => {
      const sanitized = sanitizeQaExclusions("notes/100%");

      expect(sanitized.split(",")).toEqual([encodeURIComponent("notes/100%")]);
    });
  });

  describe("sanitizeSettings()", () => {
    it.each([true, false])("preserves the agent enabled choice %s", (enabled) => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: { ...DEFAULT_SETTINGS.agentMode, backends: { claude: { enabled } } },
      });
      expect(sanitized.agentMode.backends.claude?.enabled).toBe(enabled);
    });

    it.each(["claude", "opencode", "codex"])(
      "keeps only Claude agent settings when loading a %s default",
      (activeBackend) => {
        const sanitized = sanitizeSettings({
          ...DEFAULT_SETTINGS,
          agentMode: {
            ...DEFAULT_SETTINGS.agentMode,
            activeBackend,
            backends: {
              claude: { defaultModel: { baseModelId: "sonnet", effort: "high" } },
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
        } as unknown as CopilotSettings);

        expect(sanitized.agentMode.activeBackend).toBe("claude");
        expect(Object.keys(sanitized.agentMode.backends)).toEqual(["claude"]);
        expect(sanitized.agentMode.backends.claude?.defaultModel).toEqual({
          baseModelId: "sonnet",
          effort: "high",
        });
        expect(sanitized.agentMode.deviceProfiles?.laptop).toEqual({
          claudeCliPath: "/bin/claude",
          claude: { envOverrides: { ANTHROPIC_BASE_URL: "https://example.com" } },
        });
      }
    );

    it("removes retired agent models and references while preserving Claude and ordinary chat providers", () => {
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
      } as unknown as CopilotSettings;

      const sanitized = sanitizeSettings(input);

      expect(Object.keys(sanitized.providers)).toEqual(["claude", "Codex BYOK"]);
      expect(sanitized.configuredModels.map((record) => record.configuredModelId)).toEqual([
        "sonnet",
        "gpt-5.2-codex",
      ]);
      expect(sanitized.backends).toEqual({
        chat: { enabledModels: ["gpt-5.2-codex"] },
        claude: { enabledModels: ["sonnet"] },
      });
      expect(Object.keys(input.providers)).toHaveLength(4);
      expect(input.configuredModels).toHaveLength(4);
    });

    it("falls back to ENTER when defaultSendShortcut is missing", () => {
      const settingsWithoutShortcut = {
        ...DEFAULT_SETTINGS,
        defaultSendShortcut: undefined,
      } as unknown as CopilotSettings;

      const sanitized = sanitizeSettings(settingsWithoutShortcut);

      expect(sanitized.defaultSendShortcut).toBe(SEND_SHORTCUT.ENTER);
    });

    it("falls back to ENTER when defaultSendShortcut is unrecognized", () => {
      const settingsWithInvalidShortcut = {
        ...DEFAULT_SETTINGS,
        defaultSendShortcut: "invalid-shortcut",
      } as unknown as CopilotSettings;

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
        activeBackend: "claude",
        backends: {},
        debugFullFrames: true,
        offerFeedbackCards: true,
        notificationSound: true,
        notificationSoundId: "piano",
        welcomeDismissed: false,
        skills: {
          folder: "scribe/skills",
          builtinPreferences: {},
        },
      });
    });

    it("defaults notificationSound to on so an unattended turn still calls the user back", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          byok: {},
          activeBackend: "claude",
          backends: {},
        },
      } as unknown as CopilotSettings);
      expect(sanitized.agentMode.notificationSound).toBe(true);
    });

    it("keeps a chosen notification sound and drops one no longer in the catalog (https://github.com/logancyang/obsidian-copilot/issues/2987)", () => {
      const chosen = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          byok: {},
          activeBackend: "claude",
          backends: {},
          notificationSoundId: "doorbell",
        },
      } as unknown as CopilotSettings);
      expect(chosen.agentMode.notificationSoundId).toBe("doorbell");

      const removed = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          byok: {},
          activeBackend: "claude",
          backends: {},
          notificationSoundId: "removed-sound",
        },
      } as unknown as CopilotSettings);
      expect(removed.agentMode.notificationSoundId).toBe(
        DEFAULT_SETTINGS.agentMode.notificationSoundId
      );
    });

    it("preserves an explicit notificationSound=false (a user who muted it stays muted)", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          byok: {},
          activeBackend: "claude",
          backends: {},
          notificationSound: false,
        },
      } as unknown as CopilotSettings);
      expect(sanitized.agentMode.notificationSound).toBe(false);
    });

    it("preserves an explicit debugFullFrames=false (a user who turned it off stays off)", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          byok: {},
          activeBackend: "claude",
          backends: {},
          debugFullFrames: false,
        },
      } as unknown as CopilotSettings);
      expect(sanitized.agentMode.debugFullFrames).toBe(false);
    });

    it("offers feedback cards to an install that never saved the setting, and keeps an explicit opt-out", () => {
      const base = { byok: {}, activeBackend: "claude", backends: {} };
      const fresh = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: base,
      } as unknown as CopilotSettings);
      const optedOut = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: { ...base, offerFeedbackCards: false },
      } as unknown as CopilotSettings);

      expect(fresh.agentMode.offerFeedbackCards).toBe(true);
      expect(optedOut.agentMode.offerFeedbackCards).toBe(false);
    });

    it("falls back to debugFullFrames=true when the persisted value is not a boolean", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          byok: {},
          activeBackend: "claude",
          backends: {},
          debugFullFrames: "yes" as unknown as boolean,
        },
      } as unknown as CopilotSettings);
      expect(sanitized.agentMode.debugFullFrames).toBe(true);
    });

    it("leaves backends empty when no legacy fields and no existing slice", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: { enabled: true, byok: {} },
      } as unknown as CopilotSettings);
      expect(sanitized.agentMode.backends).toEqual({});
    });

    it("defaults agentMode.welcomeDismissed to false when absent", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: { byok: {} } as unknown as CopilotSettings["agentMode"],
      });
      expect(sanitized.agentMode.welcomeDismissed).toBe(false);
    });

    it("carries a persisted agentMode.welcomeDismissed=true through sanitize", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          byok: {},
          welcomeDismissed: true,
        } as unknown as CopilotSettings["agentMode"],
      });
      expect(sanitized.agentMode.welcomeDismissed).toBe(true);
    });

    it("ignores a non-boolean agentMode.welcomeDismissed, falling back to false", () => {
      const sanitized = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          byok: {},
          welcomeDismissed: "yes",
        } as unknown as CopilotSettings["agentMode"],
      });
      expect(sanitized.agentMode.welcomeDismissed).toBe(false);
    });

    it("drops invalid envOverrides keys from the Claude backend slice while keeping valid ones", () => {
      const settings = {
        ...DEFAULT_SETTINGS,
        agentMode: {
          enabled: true,
          byok: {},
          activeBackend: "claude",
          backends: {
            claude: { envOverrides: { CLAUDE_CONFIG_DIR: "/x", "BAD KEY": "y" } },
          },
        },
      } as unknown as CopilotSettings;

      const sanitized = sanitizeSettings(settings);

      expect(sanitized.agentMode.backends.claude?.envOverrides).toEqual({
        CLAUDE_CONFIG_DIR: "/x",
      });
    });

    it("preserves valid built-in opt-outs and drops malformed preference values https://github.com/logancyang/obsidian-copilot/issues/3022", () => {
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
      } as unknown as CopilotSettings);
      expect(result.agentMode.skills.builtinPreferences).toEqual({
        "obsidian-markdown": { disabled: true, disabledAgents: ["opencode"] },
      });
    });

    it("auto-attaches the active note for settings written before the field existed (https://github.com/logancyang/obsidian-copilot/issues/3663)", () => {
      const withoutField = { ...DEFAULT_SETTINGS } as unknown as Record<string, unknown>;
      delete withoutField.autoAttachActiveNote;

      const sanitized = sanitizeSettings(withoutField as unknown as CopilotSettings);

      expect(sanitized.autoAttachActiveNote).toBe(true);
    });

    it("preserves a persisted choice to stop auto-attaching the active note (https://github.com/logancyang/obsidian-copilot/issues/3663)", () => {
      const sanitized = sanitizeSettings({ ...DEFAULT_SETTINGS, autoAttachActiveNote: false });

      expect(sanitized.autoAttachActiveNote).toBe(false);
    });

    it("drops a persisted global output cap so it cannot truncate answers again (https://github.com/logancyang/obsidian-copilot-preview/issues/312)", () => {
      const withRetiredCap = {
        ...DEFAULT_SETTINGS,
        maxTokens: 6000,
        quickCommandIncludeNoteContext: false,
      } as unknown as CopilotSettings;

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

    it("keeps a Claude auto permission mode the SDK understands", () => {
      const sanitized = sanitizeClaudeSlice("acceptEdits");

      expect(sanitized.agentMode.backends.claude?.autoModePermission).toBe("acceptEdits");
    });

    it("drops an unsupported Claude auto permission mode so the descriptor default applies", () => {
      const sanitized = sanitizeClaudeSlice("dontAsk");

      expect(sanitized.agentMode.backends.claude?.autoModePermission).toBeUndefined();
    });

    it("falls back to the default copilotFolder when it is whitespace-only", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        copilotFolder: "   ",
      });
      expect(out.copilotFolder).toBe(DEFAULT_SETTINGS.copilotFolder);
    });

    it("trims surrounding whitespace from a custom copilotFolder", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        copilotFolder: "  my-ai  ",
      });
      expect(out.copilotFolder).toBe("my-ai");
    });

    it("keeps a nested custom copilotFolder", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        copilotFolder: "notes/ai",
      });
      expect(out.copilotFolder).toBe("notes/ai");
    });

    it("loads a hidden copilotFolder as its visible name so every feature can index it (https://github.com/Brevilabs/obsidian-copilot-private/issues/712)", () => {
      for (const [hidden, visible] of [
        [".copilot", "copilot"],
        ["notes/.ai/", "notes/ai"],
      ]) {
        const out = sanitizeSettings({ ...DEFAULT_SETTINGS, copilotFolder: hidden });
        expect(out.copilotFolder).toBe(visible);
        expect(out.copilotRootHistory).toContain(visible);
      }
    });

    it("unions the active root into a normalized, deduped copilotRootHistory", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        copilotFolder: "team-ai",
        copilotRootHistory: ["copilot", "ai", "copilot"],
      });
      expect(new Set(out.copilotRootHistory)).toEqual(new Set(["copilot", "ai", "team-ai"]));
    });

    it("adds the active root to copilotRootHistory even when the history is missing", () => {
      const raw = { ...DEFAULT_SETTINGS, copilotFolder: "ai" } as unknown as Record<
        string,
        unknown
      >;
      delete raw.copilotRootHistory;
      const out = sanitizeSettings(raw as unknown as CopilotSettings);
      expect(out.copilotRootHistory).toContain("ai");
    });

    it("coerces a non-boolean upgradedToV8FromLegacy to false", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        upgradedToV8FromLegacy: undefined,
      } as unknown as CopilotSettings);
      expect(out.upgradedToV8FromLegacy).toBe(false);
    });

    it("preserves upgradedToV8FromLegacy=true", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        upgradedToV8FromLegacy: true,
      });
      expect(out.upgradedToV8FromLegacy).toBe(true);
    });

    it("falls back to the default copilotFolder for every path validateCopilotFolder rejects and keeps a valid nested folder", () => {
      for (const value of ["../escape", "/etc/passwd", "C:/x", "", "NUL", "copilot."]) {
        const out = sanitizeSettings({ ...DEFAULT_SETTINGS, copilotFolder: value });
        expect(out.copilotFolder).toBe(DEFAULT_SETTINGS.copilotFolder);
      }
      const kept = sanitizeSettings({ ...DEFAULT_SETTINGS, copilotFolder: "team/ai" });
      expect(kept.copilotFolder).toBe("team/ai");
    });

    it("preserves a valid deviceProfiles map and drops empty or invalid entries", () => {
      const raw = {
        agentMode: {
          deviceProfiles: {
            "device-a": {
              claudeCliPath: "/a/claude",
              opencode: { binaryPath: "/a/oc", binaryVersion: "1", binarySource: "custom" },
              codex: { envOverrides: { GOOD: "1", "bad-key": "x" } },
            },
            "device-b": {},
            "": { claudeCliPath: "/x" },
          },
        },
      };

      const out = sanitizeSettings(raw as unknown as CopilotSettings);
      const profiles = out.agentMode.deviceProfiles ?? {};

      expect(profiles["device-a"]?.claudeCliPath).toBe("/a/claude");
      expect(Object.keys(profiles["device-a"] ?? {})).toEqual(["claudeCliPath"]);
      expect(profiles["device-b"]).toBeUndefined();
      expect(profiles[""]).toBeUndefined();
    });
  });

  describe("sanitizeEnvOverrides()", () => {
    it("returns undefined for non-objects", () => {
      expect(sanitizeEnvOverrides(undefined)).toBeUndefined();
      expect(sanitizeEnvOverrides(null)).toBeUndefined();
      expect(sanitizeEnvOverrides("foo")).toBeUndefined();
      expect(sanitizeEnvOverrides(42)).toBeUndefined();
      expect(sanitizeEnvOverrides([1, 2])).toBeUndefined();
    });

    it("returns undefined when no valid entries remain", () => {
      expect(sanitizeEnvOverrides({})).toBeUndefined();
      expect(sanitizeEnvOverrides({ "": "v", "1FOO": "v", "BAR=BAZ": "v" })).toBeUndefined();
    });

    it("keeps valid POSIX identifiers and string values", () => {
      expect(
        sanitizeEnvOverrides({
          CLAUDE_CONFIG_DIR: "/tmp/claude",
          _PRIVATE: "x",
          myVar2: "y",
        })
      ).toEqual({
        CLAUDE_CONFIG_DIR: "/tmp/claude",
        _PRIVATE: "x",
        myVar2: "y",
      });
    });

    it("drops keys with leading digits, equals signs, whitespace, or invalid characters", () => {
      expect(
        sanitizeEnvOverrides({
          "1FOO": "v",
          "FOO BAR": "v",
          "FOO=BAR": "v",
          "FOO-BAR": "v",
          VALID: "v",
        })
      ).toEqual({ VALID: "v" });
    });

    it("drops entries whose value isn't a string or contains control chars", () => {
      expect(
        sanitizeEnvOverrides({
          OK: "fine",
          NUM: 42,
          NULLED: null,
          UNDEF: undefined,
          TABS: "ok\twith\ttabs",
          NEWLINE: "ok\nnewline",
        })
      ).toEqual({ OK: "fine" });
    });

    it("caps at 64 entries to bound persisted size", () => {
      const big: Record<string, string> = {};
      for (let i = 0; i < 100; i++) big[`VAR_${i}`] = String(i);
      const sanitized = sanitizeEnvOverrides(big);
      expect(sanitized && Object.keys(sanitized).length).toBe(64);
    });
  });

  describe("sanitizeBuiltinPreferences()", () => {
    it.each([
      undefined,
      null,
      false,
      [],
      {},
      { "obsidian-markdown": { disabled: false, disabledAgents: [] } },
    ])(
      "keeps absent, malformed, or default preferences empty: %p https://github.com/logancyang/obsidian-copilot/issues/3022",
      (raw) => {
        expect(sanitizeBuiltinPreferences(raw)).toBe(sanitizeBuiltinPreferences({}));
        expect(sanitizeBuiltinPreferences(raw)).toEqual({});
      }
    );

    it("drops retired names and malformed entries while preserving sparse overrides for known skills and absent agents https://github.com/logancyang/obsidian-copilot/issues/3022 https://github.com/Brevilabs/obsidian-copilot-private/issues/736 https://github.com/Brevilabs/obsidian-copilot-private/issues/740", () => {
      expect(
        sanitizeBuiltinPreferences({
          "obsidian-markdown": { disabled: true },
          "obsidian-bases": { disabled: false, disabledAgents: ["uninstalled-agent", 3] },
          "copilot-read-pdf": null,
          "retired-skill": { disabled: true },
        })
      ).toEqual({
        "obsidian-markdown": { disabled: true },
        "obsidian-bases": { disabledAgents: ["uninstalled-agent"] },
      });
    });
  });

  describe("validateCopilotFolder()", () => {
    it("rejects empty and whitespace-only values", () => {
      expect(validateCopilotFolder("").ok).toBe(false);
      expect(validateCopilotFolder("   ").ok).toBe(false);
    });

    it("accepts a simple relative folder and trims it", () => {
      expect(validateCopilotFolder("  my-ai  ")).toEqual({ ok: true, folder: "my-ai" });
    });

    it("accepts a nested relative folder and strips a trailing slash", () => {
      expect(validateCopilotFolder("notes/ai/")).toEqual({ ok: true, folder: "notes/ai" });
    });

    it("rejects parent-traversal, absolute, and drive-letter paths", () => {
      expect(validateCopilotFolder("../escape").ok).toBe(false);
      expect(validateCopilotFolder("a/../b").ok).toBe(false);
      expect(validateCopilotFolder("/etc/passwd").ok).toBe(false);
      expect(validateCopilotFolder("C:/Users/evil").ok).toBe(false);
    });

    it("rejects any segment that starts with a dot, because Obsidian does not index hidden folders (https://github.com/Brevilabs/obsidian-copilot-private/issues/712)", () => {
      expect(validateCopilotFolder(".copilot")).toEqual({
        ok: false,
        reason: "Folder names cannot start with a dot.",
      });
      expect(validateCopilotFolder("notes/.ai").ok).toBe(false);
      expect(validateCopilotFolder("a/./b").ok).toBe(false);
      expect(validateCopilotFolder("notes.ai/copilot").ok).toBe(true);
    });

    it("rejects roots that overlap the active config folder at a segment boundary", () => {
      const configDir = ".vault-config";
      expect(validateCopilotFolder(configDir, configDir).ok).toBe(false);
      expect(validateCopilotFolder(`${configDir.toUpperCase()}/plugins`, configDir).ok).toBe(false);
      expect(validateCopilotFolder("copilot", "copilot/system-prompts").ok).toBe(false);
      expect(validateCopilotFolder("copilot-data", "copilot/system-prompts").ok).toBe(true);
    });

    it("rejects Windows-illegal characters in any segment", () => {
      expect(validateCopilotFolder("a/b<c").ok).toBe(false);
      expect(validateCopilotFolder('a/b"c').ok).toBe(false);
      expect(validateCopilotFolder("a/b|c").ok).toBe(false);
    });

    it("rejects Windows-reserved device names in any segment, any case, with or without extension", () => {
      expect(validateCopilotFolder("NUL").ok).toBe(false);
      expect(validateCopilotFolder("team/CON").ok).toBe(false);
      expect(validateCopilotFolder("con.md").ok).toBe(false);
      expect(validateCopilotFolder("Com1").ok).toBe(false);
      expect(validateCopilotFolder("console").ok).toBe(true);
      expect(validateCopilotFolder("nul-notes").ok).toBe(true);
    });

    it("rejects segments ending with a dot or space on every platform", () => {
      expect(validateCopilotFolder("copilot.").ok).toBe(false);
      expect(validateCopilotFolder("team /ai").ok).toBe(false);
      expect(validateCopilotFolder("team./ai").ok).toBe(false);
    });
  });

  describe("toVisibleCopilotFolder()", () => {
    it("drops the leading dots of every segment and keeps visible paths unchanged", () => {
      expect(toVisibleCopilotFolder(" .copilot ")).toBe("copilot");
      expect(toVisibleCopilotFolder("..a\\.b/c.d")).toBe("a\\b/c.d");
      expect(toVisibleCopilotFolder("notes/ai")).toBe("notes/ai");
    });

    it("turns traversal segments into empty segments that validation still rejects", () => {
      expect(validateCopilotFolder(toVisibleCopilotFolder("../escape")).ok).toBe(false);
      expect(validateCopilotFolder(toVisibleCopilotFolder("a/../b")).ok).toBe(false);
    });
  });

  describe("normalizeRootFolders()", () => {
    it("preserves case and strips trailing slashes without lowercasing", () => {
      expect(normalizeRootFolders(["Copilot/", "ai//"])).toEqual(["Copilot", "ai"]);
    });

    it("dedupes case-sensitively, preserving first-seen order", () => {
      expect(normalizeRootFolders(["copilot", "ai", "copilot", "Copilot"])).toEqual([
        "copilot",
        "ai",
        "Copilot",
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

  describe("resetSettings()", () => {
    it("preserves historical roots and folds in the pre-reset active root", () => {
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        copilotFolder: "team-ai",
        copilotRootHistory: ["copilot", "ai"],
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.copilotFolder).toBe(DEFAULT_SETTINGS.copilotFolder);
      expect(new Set(after.copilotRootHistory)).toEqual(new Set(["copilot", "ai", "team-ai"]));
    });

    it("preserves every custom model, including rows that carry no key (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
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

    it("preserves the top-level vendor config a retained key needs to reach its service (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
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

    it("drops a bundle value whose type its consumer cannot handle (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
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

    it("preserves configured models belonging to preserved providers (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
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
          claude: { enabledModels: ["model-3"] },
        },
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.providers.prov1).toBeDefined();
      expect(after.backends).toEqual(DEFAULT_SETTINGS.backends);
    });
  });
});
