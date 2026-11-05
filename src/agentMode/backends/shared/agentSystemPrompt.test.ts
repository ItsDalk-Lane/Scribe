import { resetSettings, updateSetting } from "@/settings/model";
import type { App } from "obsidian";
import {
  buildAgentSystemPrompt,
  SCRIBE_EXCALIDRAW_STEERING,
  SCRIBE_FOLDER_MENTION_DIRECTIVE,
  SCRIBE_PROMPT_BASE,
  SCRIBE_VAULT_HYGIENE,
  SCRIBE_WEB_RESEARCH_STEERING,
} from "./agentSystemPrompt";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));
const AGENT = "native";
const APP = {} as App;
const EXCALIDRAW_APP = {
  plugins: {
    getPlugin: (id: string) =>
      id === "obsidian-excalidraw-plugin" ? { ea: { executeCLI: jest.fn() } } : null,
  },
} as unknown as App;
describe("agentSystemPrompt", () => {
  describe("buildAgentSystemPrompt", () => {
    beforeEach(() => {
      resetSettings();
    });

    it("keeps the full prompt compact without legacy agent restrictions", () => {
      const prompt = buildAgentSystemPrompt(AGENT, APP);
      expect(Buffer.byteLength(prompt, "utf8")).toBeLessThan(3000);
      expect(prompt).not.toMatch(
        /NEVER search for the same|After 1-2 searches|Never claim you do not have access|delimiter row of dashes|## Task planning/
      );
    });

    it("does not advertise removed search or document services", () => {
      const prompt = buildAgentSystemPrompt(AGENT, APP);
      expect(prompt).not.toMatch(/miyo/i);
      expect(prompt).toContain(SCRIBE_WEB_RESEARCH_STEERING);
    });

    it("starts with the Scribe base prompt and includes the folder-mention directive by default", () => {
      const prompt = buildAgentSystemPrompt(AGENT, APP);
      expect(prompt.startsWith(SCRIBE_PROMPT_BASE)).toBe(true);
      expect(prompt).toContain(SCRIBE_FOLDER_MENTION_DIRECTIVE);
      expect(prompt).not.toContain("<user_custom_instructions>");
    });

    it("keeps backend steering after the shared instructions", () => {
      const steering = "Backend-specific steering.";
      const prompt = buildAgentSystemPrompt(AGENT, APP, steering);
      expect(prompt).toContain(
        `${SCRIBE_FOLDER_MENTION_DIRECTIVE}\n\n${SCRIBE_VAULT_HYGIENE}\n\n${steering}`
      );
      expect(buildAgentSystemPrompt(AGENT, APP)).not.toContain(steering);
    });

    it("does not direct the model to the removed feedback tool https://github.com/ItsDalk-Lane/Scribe/issues/31", () => {
      expect(buildAgentSystemPrompt(AGENT, APP)).not.toContain("send_feedback");
    });

    it("does not advertise skills that are no longer bundled (https://github.com/ItsDalk-Lane/Scribe/issues/32)", () => {
      expect(buildAgentSystemPrompt(AGENT, APP)).not.toMatch(
        /obsidian-markdown|obsidian-bases|json-canvas|obsidian-cli/
      );
    });

    it("keeps shared instructions independent of model and data-folder choices", () => {
      const baseline = buildAgentSystemPrompt(AGENT, APP);
      updateSetting("defaultModelKey", "some-other-model|anthropic");
      updateSetting("projectsFolder", "vault-b/projects");
      expect(buildAgentSystemPrompt(AGENT, APP)).toBe(baseline);
    });

    it("leaves the project outputs/ policy out of the prompt every chat shares, so non-project chats never save there", () => {
      expect(buildAgentSystemPrompt(AGENT, APP)).not.toContain("outputs/");
    });

    it("tells each agent to edit vault files with its own edit tools so Scribe can show a diff", () => {
      expect(buildAgentSystemPrompt("native", APP)).toContain(
        "Edit vault files with your edit_note/write_note tools so Scribe shows a diff"
      );
    });

    it("limits shell file writes, not other shell use, to moves, script rewrites of most of a large file, and bulk changes across dozens of files", () => {
      expect(buildAgentSystemPrompt(AGENT, APP)).toContain(
        "Write via shell only to move, copy or delete files; to have a script rewrite most of a large file (sort, dedupe, recompute), not retyping it; or one mechanical change to dozens of files. Then list changed files."
      );
    });

    it("leaves the 200-line write cap out of every agent's shared prompt, so skills' own write instructions stand", () => {
      for (const backendId of ["native"] as const) {
        expect(buildAgentSystemPrompt(backendId, APP)).not.toContain("200 lines");
      }
    });

    it(`tells every agent to keep backups and scratch files out of the vault or off.md, so they don't become duplicate notes`, () => {
      for (const backendId of ["native"] as const) {
        expect(buildAgentSystemPrompt(backendId, APP)).toContain(
          "Keep backups and scratch files out of the vault, or use a non-.md extension like .md.bak, so they don't show up as notes."
        );
      }
    });

    it("includes the web research steering by default", () => {
      expect(buildAgentSystemPrompt(AGENT, APP)).toContain(SCRIBE_WEB_RESEARCH_STEERING);
    });

    it("steers diagrams to embedded Excalidraw drawings, keeping Mermaid or a canvas the user names, only while the Excalidraw tools are available", () => {
      expect(buildAgentSystemPrompt(AGENT, APP)).not.toContain(SCRIBE_EXCALIDRAW_STEERING);

      expect(buildAgentSystemPrompt(AGENT, EXCALIDRAW_APP)).toContain(
        "Draw diagrams, flowcharts and charts as Excalidraw drawings with the obsidian-scribe excalidraw tools, and embed each one (![[name.excalidraw]]) in the note it belongs to, unless the user asks for Mermaid, a canvas or another format."
      );
    });

    it("never copies user-authored project instructions or context payloads", () => {
      const prompt = buildAgentSystemPrompt(AGENT, APP);
      expect(prompt).not.toContain("<project_instructions>");
      expect(prompt).not.toMatch(/<project_context>[\s\S]*<\/project_context>/);
    });

    it("carries no vault path, date, model id or session id", () => {
      const prompt = buildAgentSystemPrompt(AGENT, APP);

      expect(prompt).not.toMatch(/\/Users\/|[A-Z]:\\/);
      expect(prompt).not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
      expect(prompt).not.toMatch(/\bsession[-_ ]?id\b/i);
    });
  });

  describe("SCRIBE_PROMPT_BASE", () => {
    it("does not carry chat-mode-only baggage that misfires in tool-driven agents", () => {
      expect(SCRIBE_PROMPT_BASE).not.toMatch(/@vault/);
      expect(SCRIBE_PROMPT_BASE).not.toMatch(/getCurrentTime/);
      expect(SCRIBE_PROMPT_BASE).not.toMatch(/getTimeRangeMs/);
      expect(SCRIBE_PROMPT_BASE).not.toMatch(/YouTube/);
    });
  });
});
