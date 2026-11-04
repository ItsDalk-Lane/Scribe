import { getSettings, resetSettings, updateSetting, type CopilotSettings } from "@/settings/model";
import { isObsidianCliEnabled } from "@/services/obsidianCli/ObsidianCliClient";
import type { App } from "obsidian";
import {
  buildAgentSystemPrompt,
  COPILOT_EXCALIDRAW_STEERING,
  COPILOT_FOLDER_MENTION_DIRECTIVE,
  COPILOT_FEEDBACK_POINTER,
  COPILOT_OBSIDIAN_CLI_STEERING,
  COPILOT_PROMPT_BASE,
  COPILOT_VAULT_HYGIENE,
  COPILOT_WEB_RESEARCH_STEERING,
} from "./agentSystemPrompt";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));
jest.mock("@/services/obsidianCli/ObsidianCliClient", () => ({
  isObsidianCliEnabled: jest.fn(),
}));

const mockIsObsidianCliEnabled = jest.mocked(isObsidianCliEnabled);

const ISSUE_441 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/441";
const ISSUE_726 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/726";
const ISSUE_3868 = "https://github.com/logancyang/obsidian-copilot/issues/3868";
const AGENT = "native";
const APP = {} as App;
const EXCALIDRAW_APP = {
  plugins: {
    getPlugin: (id: string) =>
      id === "obsidian-excalidraw-plugin" ? { ea: { executeCLI: jest.fn() } } : null,
  },
} as unknown as App;
const ALL_OBSIDIAN_FORMAT_SKILLS_LINE =
  "Before writing Obsidian syntax, load its skill and follow it over memory: obsidian-markdown for embeds, block IDs, callouts, comments and properties, obsidian-bases for .base files, json-canvas for .canvas files.";

function setBuiltinPreferences(
  builtinPreferences: NonNullable<CopilotSettings["agentMode"]["skills"]["builtinPreferences"]>
): void {
  const agentMode = getSettings().agentMode;
  updateSetting("agentMode", { ...agentMode, skills: { ...agentMode.skills, builtinPreferences } });
}

describe("agentSystemPrompt", () => {
  describe("buildAgentSystemPrompt()", () => {
    beforeEach(() => {
      resetSettings();
      mockIsObsidianCliEnabled.mockReturnValue(true);
    });

    it("keeps the full prompt compact without legacy agent restrictions (https://github.com/Brevilabs/obsidian-copilot-private/issues/596)", () => {
      const prompt = buildAgentSystemPrompt(AGENT, APP);
      expect(Buffer.byteLength(prompt, "utf8")).toBeLessThan(3000);
      expect(prompt).not.toMatch(
        /NEVER search for the same|After 1-2 searches|Never claim you do not have access|delimiter row of dashes|## Task planning/
      );
    });

    it("does not advertise removed search or document services", () => {
      const prompt = buildAgentSystemPrompt(AGENT, APP);
      expect(prompt).not.toMatch(/miyo/i);
      expect(prompt).toContain(COPILOT_WEB_RESEARCH_STEERING);
    });

    it("starts with the Copilot base prompt and includes the folder-mention directive by default", () => {
      const prompt = buildAgentSystemPrompt(AGENT, APP);
      expect(prompt.startsWith(COPILOT_PROMPT_BASE)).toBe(true);
      expect(prompt).toContain(COPILOT_FOLDER_MENTION_DIRECTIVE);
      expect(prompt).not.toContain("<user_custom_instructions>");
    });

    it(`places a backend's own steering after the always-on lines and before the settings-dependent ones (${ISSUE_441})`, () => {
      const steering = "Backend-specific steering.";
      const prompt = buildAgentSystemPrompt(AGENT, APP, steering);

      expect(prompt).toContain(
        `${COPILOT_FOLDER_MENTION_DIRECTIVE}\n\n${COPILOT_VAULT_HYGIENE}\n\n${steering}\n\n${COPILOT_FEEDBACK_POINTER}`
      );
      expect(buildAgentSystemPrompt(AGENT, APP)).not.toContain(steering);
    });

    it("leaves the project outputs/ policy out of the prompt every chat shares, so non-project chats never save there https://github.com/logancyang/obsidian-copilot/issues/3801", () => {
      expect(buildAgentSystemPrompt(AGENT, APP)).not.toContain("outputs/");
    });

    it("tells each agent to edit vault files with its own edit tools so Copilot can show a diff (https://github.com/Brevilabs/obsidian-copilot-private/issues/701)", () => {
      expect(buildAgentSystemPrompt("native", APP)).toContain(
        "Edit vault files with your edit_note/write_note tools so Scribe shows a diff"
      );
    });

    it("limits shell file writes, not other shell use, to moves, script rewrites of most of a large file, and bulk changes across dozens of files (https://github.com/Brevilabs/obsidian-copilot-private/issues/701)", () => {
      expect(buildAgentSystemPrompt(AGENT, APP)).toContain(
        "Write via shell only to move, copy or delete files; to have a script rewrite most of a large file (sort, dedupe, recompute), not retyping it; or one mechanical change to dozens of files. Then list changed files."
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/741 leaves the 200-line write cap out of every agent's shared prompt, so skills' own write instructions stand", () => {
      for (const backendId of ["native"] as const) {
        expect(buildAgentSystemPrompt(backendId, APP)).not.toContain("200 lines");
      }
    });

    it(`tells every agent to keep backups and scratch files out of the vault or off .md, so they don't become duplicate notes (${ISSUE_3868})`, () => {
      for (const backendId of ["native"] as const) {
        expect(buildAgentSystemPrompt(backendId, APP)).toContain(
          "Keep backups and scratch files out of the vault, or use a non-.md extension like .md.bak, so they don't show up as notes."
        );
      }
    });

    it("includes the web research steering by default", () => {
      expect(buildAgentSystemPrompt(AGENT, APP)).toContain(COPILOT_WEB_RESEARCH_STEERING);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/787 steers diagrams to embedded Excalidraw drawings, keeping Mermaid or a canvas the user names, only while the Excalidraw tools are available", () => {
      expect(buildAgentSystemPrompt(AGENT, APP)).not.toContain(COPILOT_EXCALIDRAW_STEERING);

      expect(buildAgentSystemPrompt(AGENT, EXCALIDRAW_APP)).toContain(
        "Draw diagrams, flowcharts and charts as Excalidraw drawings with the obsidian-scribe excalidraw tools, and embed each one (![[name.excalidraw]]) in the note it belongs to, unless the user asks for Mermaid, a canvas or another format."
      );
    });

    it(`tells every agent to load the matching Obsidian skill before writing Obsidian Markdown, .base or .canvas files (${ISSUE_726})`, () => {
      setBuiltinPreferences({});
      for (const agent of ["native"]) {
        expect(buildAgentSystemPrompt(agent, APP)).toContain(ALL_OBSIDIAN_FORMAT_SKILLS_LINE);
      }
    });

    it(`includes the existing steering for all always-enabled builtin skills (${ISSUE_726}, https://github.com/logancyang/obsidian-copilot/issues/3868)`, () => {
      expect(buildAgentSystemPrompt(AGENT, APP)).toContain(ALL_OBSIDIAN_FORMAT_SKILLS_LINE);
      expect(buildAgentSystemPrompt(AGENT, APP)).toContain(COPILOT_OBSIDIAN_CLI_STEERING);
    });

    it(`drops opted-out builtin skills from the format steering (${ISSUE_726})`, () => {
      setBuiltinPreferences({
        "obsidian-markdown": { disabledAgents: [AGENT] },
        "obsidian-bases": { disabled: true },
      });
      const prompt = buildAgentSystemPrompt(AGENT, APP);
      expect(prompt).toContain("json-canvas for .canvas files");
      expect(prompt).not.toContain("obsidian-markdown for");
      expect(prompt).not.toContain("obsidian-bases for");

      setBuiltinPreferences({
        "obsidian-markdown": { disabled: true },
        "obsidian-bases": { disabled: true },
        "json-canvas": { disabledAgents: [AGENT] },
      });
      expect(buildAgentSystemPrompt(AGENT, APP)).not.toContain("Before writing Obsidian syntax");
    });

    it(`drops the CLI steering when the builtin skill is opted out (${ISSUE_726})`, () => {
      setBuiltinPreferences({});
      expect(buildAgentSystemPrompt(AGENT, APP)).toContain(
        "Obsidian is running: the obsidian-cli skill reaches its live state and index (open tabs, daily notes, backlinks, broken links, Bases results, templates) and link-aware renames. Prefer it over searching files for links and Bases results."
      );

      setBuiltinPreferences({ "obsidian-cli": { disabledAgents: [AGENT] } });
      expect(buildAgentSystemPrompt(AGENT, APP)).not.toContain(COPILOT_OBSIDIAN_CLI_STEERING);
    });

    it(`drops the obsidian-cli line while Obsidian's command line interface is off, keeping the format skills (${ISSUE_726})`, () => {
      setBuiltinPreferences({});
      mockIsObsidianCliEnabled.mockReturnValue(false);

      const prompt = buildAgentSystemPrompt(AGENT, APP);
      expect(prompt).not.toContain(COPILOT_OBSIDIAN_CLI_STEERING);
      expect(prompt).not.toContain("obsidian-cli");
      expect(prompt).toContain(ALL_OBSIDIAN_FORMAT_SKILLS_LINE);
    });

    it("never copies user-authored project instructions or context payloads", () => {
      const prompt = buildAgentSystemPrompt(AGENT, APP);
      expect(prompt).not.toContain("<project_instructions>");
      expect(prompt).not.toMatch(/<project_context>[\s\S]*<\/project_context>/);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 points the agent at send_feedback while feedback cards are on", () => {
      expect(buildAgentSystemPrompt(AGENT, APP)).toContain(COPILOT_FEEDBACK_POINTER);
    });

    it("drops the send_feedback pointer when the user turns feedback cards off", () => {
      updateSetting("agentMode", { ...getSettings().agentMode, offerFeedbackCards: false });
      expect(buildAgentSystemPrompt(AGENT, APP)).not.toContain(COPILOT_FEEDBACK_POINTER);
    });

    it("emits identical bytes across vaults, projects, models and sessions", () => {
      const baseline = buildAgentSystemPrompt(AGENT, APP);

      updateSetting("defaultModelKey", "some-other-model|anthropic");
      updateSetting("projectsFolder", "vault-b/projects");
      updateSetting("defaultSaveFolder", "vault-b/chats");

      expect(buildAgentSystemPrompt(AGENT, APP)).toBe(baseline);
    });

    it("carries no vault path, date, model id or session id", () => {
      const prompt = buildAgentSystemPrompt(AGENT, APP);

      expect(prompt).not.toMatch(/\/Users\/|[A-Z]:\\/);
      expect(prompt).not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
      expect(prompt).not.toMatch(/\bsession[-_ ]?id\b/i);
    });
  });

  describe("COPILOT_PROMPT_BASE", () => {
    it("does not carry chat-mode-only baggage that misfires in tool-driven agents", () => {
      expect(COPILOT_PROMPT_BASE).not.toMatch(/@vault/);
      expect(COPILOT_PROMPT_BASE).not.toMatch(/getCurrentTime/);
      expect(COPILOT_PROMPT_BASE).not.toMatch(/getTimeRangeMs/);
      expect(COPILOT_PROMPT_BASE).not.toMatch(/YouTube/);
    });
  });
});
