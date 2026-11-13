import { link, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FileSystemAdapter, type App } from "obsidian";
import { searchWithSkill } from "@/agentMode/backends/native/skillWebSearch";
import type { NativeToolContext } from "@/agentMode/sdk/NativeBackendProcess";
import type { Skill } from "@/agentMode/skills/types";

const executePython = jest.fn<Promise<{ stdout: string }>, [string, string[], unknown]>();

jest.mock("child_process", () => {
  const { promisify } = jest.requireActual<typeof import("node:util")>("util");
  return {
    execFile: Object.assign(() => undefined, {
      [promisify.custom]: (...args: Parameters<typeof executePython>) => executePython(...args),
    }),
  };
});

describe("skillWebSearch", () => {
  describe("searchWithSkill()", () => {
    let vault: string;
    let script: string;
    let app: App;
    let context: NativeToolContext;
    let skill: Skill;
    let controller: AbortController;
    const query = 'Obsidian & "中文" $(echo example)';
    const allow = { outcome: { outcome: "selected", optionId: "allow_once" } } as const;

    beforeEach(async () => {
      executePython.mockReset();
      vault = await realpath(await mkdtemp(join(tmpdir(), "scribe-skill-search-")));
      script = join(vault, ".scribe", "skills", "research", "scripts", "search.py");
      await mkdir(dirname(script), { recursive: true });
      await writeFile(script, "pass\n");
      const adapter = new FileSystemAdapter();
      adapter.getBasePath = () => vault;
      app = { vault: { adapter } } as unknown as App;
      context = {
        sessionId: "chat",
        requester: "main",
        getMode: jest.fn(() => "default"),
        requestPermission: jest.fn().mockResolvedValue(allow),
        assertCanExecute: jest.fn(),
      } as unknown as NativeToolContext;
      skill = {
        name: "research",
        description: "Search the web",
        body: "Search for sources",
        dirPath: dirname(dirname(script)),
        filePath: join(dirname(dirname(script)), "SKILL.md"),
        enabledAgents: ["native"],
        location: { kind: "canonical" },
        webSearchCommand: "scripts/search.py",
      };
      controller = new AbortController();
    });

    afterEach(async () => {
      await rm(vault, { recursive: true, force: true });
    });

    const search = () => searchWithSkill(app, context, skill, "search-1", query, controller.signal);

    it("asks permission and gives the approved script one literal query argument", async () => {
      executePython.mockResolvedValue({ stdout: " [Obsidian](https://obsidian.md)\n" });
      await expect(search()).resolves.toEqual({ text: "[Obsidian](https://obsidian.md)" });
      expect(context.requestPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCall: expect.objectContaining({
            toolCallId: "search-1",
            rawInput: { script: "scripts/search.py", query },
          }),
          signal: controller.signal,
        })
      );
      expect(executePython).toHaveBeenCalledWith(
        process.platform === "win32" ? "python" : "python3",
        ["-B", "-X", "utf8", script, query],
        expect.objectContaining({
          cwd: skill.dirPath,
          shell: false,
          signal: controller.signal,
          timeout: expect.any(Number),
          maxBuffer: expect.any(Number),
        })
      );
    });

    it.each([{ enabledAgents: [] }, { disableModelInvocation: true }])(
      "reports an unavailable skill without running it when invocation is disabled (%j) https://github.com/ItsDalk-Lane/Scribe/issues/70",
      async (overrides) => {
        Object.assign(skill, overrides);
        await expect(search()).resolves.toEqual({
          failure: "The selected search skill is unavailable.",
        });
        expect(context.requestPermission).not.toHaveBeenCalled();
        expect(executePython).not.toHaveBeenCalled();
      }
    );

    it("rejects a script file that aliases a file outside the skill https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      await rm(script);
      const outside = join(vault, "outside.py");
      await writeFile(outside, "raise RuntimeError()\n");
      await link(outside, script);
      await expect(search()).resolves.toEqual({
        failure: "The search skill script is unavailable.",
      });
      expect(executePython).not.toHaveBeenCalled();
    });

    it("refuses to run a script in Plan mode before asking permission https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      jest.mocked(context.getMode).mockReturnValue("plan");
      await expect(search()).rejects.toThrow("Plan approval");
      expect(context.requestPermission).not.toHaveBeenCalled();
      expect(executePython).not.toHaveBeenCalled();
    });

    it("rejects a denied permission without reporting a retryable search failure https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      jest.mocked(context.requestPermission).mockResolvedValue({
        outcome: { outcome: "selected", optionId: "reject_once" },
      });
      await expect(search()).rejects.toThrow("Permission denied");
      expect(executePython).not.toHaveBeenCalled();
    });

    it("rechecks the current command permission after approval https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      jest.mocked(context.requestPermission).mockImplementation(async () => {
        jest.mocked(context.assertCanExecute!).mockImplementation((name) => {
          if (name === "run_command") throw new Error("Command no longer allowed");
        });
        return allow;
      });
      await expect(search()).rejects.toThrow("Command no longer allowed");
      expect(executePython).not.toHaveBeenCalled();
    });

    it.each([
      ["ENOENT", "Python is unavailable for the selected search skill."],
      [5, "The search skill exited with code 5."],
    ])(
      "reports confirmed search failure for process error %s https://github.com/ItsDalk-Lane/Scribe/issues/70",
      async (code, failure) => {
        executePython.mockRejectedValue(Object.assign(new Error("private output"), { code }));
        await expect(search()).resolves.toEqual({ failure });
      }
    );

    it("reports no results for empty output https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      executePython.mockResolvedValue({ stdout: "\n " });
      await expect(search()).resolves.toEqual({ failure: "The search skill returned no results." });
    });

    it("keeps a killed process distinct from a confirmed search failure https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      executePython.mockRejectedValue(
        Object.assign(new Error("process killed"), { killed: true, code: 5 })
      );
      await expect(search()).rejects.toThrow("without a confirmed result");
    });

    it("keeps cancellation distinct from search failure even when the script reports an exit code https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      const reason = new Error("Stopped by user");
      executePython.mockImplementation(async () => {
        controller.abort(reason);
        throw Object.assign(new Error("aborted"), { code: 5 });
      });
      await expect(search()).rejects.toBe(reason);
    });
  });
});
