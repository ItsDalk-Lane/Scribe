import { act, renderHook } from "@testing-library/react";
import { FileSystemAdapter, type App } from "obsidian";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSkillFile } from "./skillFormat";
import {
  SkillManager,
  computeSkillSetSignature,
  getManagedSkills,
  useManagedSkills,
  useRejectedSkills,
} from "./SkillManager";
import { getSettings, updateSetting } from "@/settings/model";

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ debug: false, agentMode: { skills: {} } })),
  updateSetting: jest.fn(),
}));
jest.mock("@/settings/scribeFolder", () => ({ getEffectiveSkillsFolder: () => ".scribe/skills" }));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const CONTENT =
  "---\nname: review\ndescription: Review a note\nmetadata:\n  scribe-enabled-agents: native\n---\nRead carefully.";

function setup() {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const adapter = {
    exists: async (path: string) => files.has(path) || folders.has(path),
    stat: async (path: string) =>
      folders.has(path) ? { type: "folder" } : files.has(path) ? { type: "file" } : null,
    mkdir: async (path: string) => {
      folders.add(path);
    },
    read: jest.fn(async (path: string) => {
      if (!files.has(path)) throw new Error("missing file");
      return files.get(path)!;
    }),
    readBinary: jest.fn(async (path: string): Promise<ArrayBuffer> => {
      if (!files.has(path)) throw new Error("missing file");
      return new TextEncoder().encode(files.get(path)).slice().buffer;
    }),
    writeBinary: async (path: string, data: ArrayBuffer) => {
      files.set(path, new TextDecoder().decode(data));
    },
    write: jest.fn(async (path: string, value: string) => {
      files.set(path, value);
    }),
    remove: async (path: string) => {
      files.delete(path);
    },
    rmdir: async (path: string) => {
      for (const file of files.keys()) if (file.startsWith(`${path}/`)) files.delete(file);
      for (const folder of folders)
        if (folder === path || folder.startsWith(`${path}/`)) folders.delete(folder);
    },
    rename: async (from: string, to: string) => {
      if (files.has(from)) {
        files.set(to, files.get(from)!);
        files.delete(from);
        return;
      }
      for (const path of [...folders])
        if (path === from || path.startsWith(`${from}/`)) {
          folders.add(to + path.slice(from.length));
          folders.delete(path);
        }
      for (const [path, value] of [...files])
        if (path.startsWith(`${from}/`)) {
          files.set(to + path.slice(from.length), value);
          files.delete(path);
        }
    },
    list: async (path: string) => ({
      files: [...files.keys()].filter(
        (file) => file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes("/")
      ),
      folders: [...folders].filter(
        (folder) => folder.startsWith(`${path}/`) && !folder.slice(path.length + 1).includes("/")
      ),
    }),
  };
  const app = {
    vault: {
      adapter,
      getFiles: jest.fn(() => {
        throw new Error("hidden files are not indexed");
      }),
      getAbstractFileByPath: jest.fn(() => null),
    },
  } as unknown as App;
  const manager = SkillManager.initialize(app, { native: ".scribe/skills" });
  const seed = async () => {
    folders.add(".scribe");
    folders.add(".scribe/skills");
    folders.add(".scribe/skills/review");
    files.set(".scribe/skills/review/SKILL.md", CONTENT);
    await manager.refresh();
    return getManagedSkills()[0];
  };
  return { app, manager, files, folders, adapter, seed };
}

describe("SkillManager", () => {
  beforeEach(() => {
    SkillManager.resetForTesting();
    jest.clearAllMocks();
  });
  afterEach(() => SkillManager.resetForTesting());
  describe("SkillManager", () => {
    describe("initialize()", () => {
      it("reuses the same manager without creating links or subscribing to indexed file events", () => {
        const fixture = setup();
        expect(SkillManager.initialize(fixture.app, { native: ".scribe/skills" })).toBe(
          fixture.manager
        );
        expect(fixture.manager.getAgentDirsProjectRel()).toEqual({ native: ".scribe/skills" });
        expect(SkillManager.hasInstance()).toBe(true);
        expect(SkillManager.getInstance()).toBe(fixture.manager);
      });
    });
    describe("refresh()", () => {
      it("loads hidden personal skills while ignoring unrelated old locations", async () => {
        const fixture = setup();
        fixture.folders.add("old-skills/review");
        fixture.files.set("old-skills/review/SKILL.md", CONTENT);
        await fixture.seed();
        expect(getManagedSkills()).toHaveLength(1);
        expect(getManagedSkills()[0].filePath).toBe(".scribe/skills/review/SKILL.md");
        expect(fixture.app.vault.getFiles).not.toHaveBeenCalled();
        expect(
          fixture.adapter.read.mock.calls.every(([path]) => path.startsWith(".scribe/skills/"))
        ).toBe(true);
      });
      it("classifies existing files without a source record as local", async () => {
        const fixture = setup();
        await fixture.seed();
        expect(getManagedSkills()[0].source?.kind).toBe("local");
      });
      it("publishes malformed skill information and clears it after repair", async () => {
        const fixture = setup();
        const { result } = renderHook(() => ({
          skills: useManagedSkills(),
          errors: useRejectedSkills(),
        }));
        await act(async () => {
          await fixture.seed();
        });
        expect(result.current.skills).toHaveLength(1);
        fixture.files.set(".scribe/skills/review/SKILL.md", "---\nname: wrong-name\n---\nBroken");
        await act(async () => {
          await fixture.manager.refresh();
        });
        expect(result.current.errors).toHaveLength(1);
        fixture.files.set(".scribe/skills/review/SKILL.md", CONTENT);
        await act(async () => {
          await fixture.manager.refresh();
        });
        expect(result.current.errors).toEqual([]);
      });
    });
    describe("createSkill()", () => {
      it("creates a usable skill under the fixed folder without adding a link", async () => {
        const fixture = setup();
        expect(await fixture.manager.createSkill("review", CONTENT)).toEqual({ ok: true });
        expect(getManagedSkills()[0].enabledAgents).toEqual(["native"]);
        expect([...fixture.files.keys()]).toEqual([
          ".scribe/skills/review/SKILL.md",
          ".scribe/skills/.registry.json",
        ]);
      });
      it.each([
        ["ENOSPC", "Not enough free space"],
        ["EACCES", "folder permissions"],
        ["EPERM", "folder permissions"],
      ])("explains %s without leaving an installed skill", async (code, message) => {
        const fixture = setup();
        fixture.adapter.write.mockRejectedValueOnce(
          Object.assign(new Error("native file error"), { code })
        );
        expect(await fixture.manager.createSkill("review", CONTENT)).toMatchObject({
          ok: false,
          message: expect.stringContaining(message),
        });
        expect(fixture.files.has(".scribe/skills/review/SKILL.md")).toBe(false);
      });
      it("does not overwrite an existing skill directory", async () => {
        const fixture = setup();
        await fixture.seed();
        expect(await fixture.manager.createSkill("review", CONTENT)).toMatchObject({
          ok: false,
          code: "collision",
        });
        expect(fixture.files.get(".scribe/skills/review/SKILL.md")).toBe(CONTENT);
      });
    });
    describe("readContent()", () => {
      it("reads the saved document and rejects a reference outside the new store", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        expect(await fixture.manager.readContent(skill)).toBe(CONTENT);
        await expect(
          fixture.manager.readContent({ ...skill, filePath: "old-skills/review/SKILL.md" })
        ).rejects.toThrow();
      });
    });
    describe("listSkillFiles()", () => {
      it("lists nested source files while rejecting a skill reference with a different folder identity", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        fixture.folders.add(".scribe/skills/review/references");
        fixture.files.set(".scribe/skills/review/references/guide.md", "Supporting text");
        fixture.files.set(".scribe/skills/review/image.png", "\0binary");
        expect(await fixture.manager.listSkillFiles(skill)).toEqual([
          "SKILL.md",
          "image.png",
          "references/guide.md",
        ]);
        await expect(
          fixture.manager.listSkillFiles({ ...skill, name: "another-skill" })
        ).rejects.toThrow();
      });
    });
    describe("readSkillFile()", () => {
      it("reads a supporting text file exactly and rejects paths outside the selected skill", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        fixture.folders.add(".scribe/skills/review/references");
        fixture.files.set(".scribe/skills/review/references/guide.md", "中文\nCode  123\n");
        expect(await fixture.manager.readSkillFile(skill, "references/guide.md")).toBe(
          "中文\nCode  123\n"
        );
        for (const path of [
          "../other/SKILL.md",
          "/etc/passwd",
          "a\\b",
          "",
          "./SKILL.md",
          "a//b",
          "C:foo",
        ]) {
          await expect(fixture.manager.readSkillFile(skill, path)).rejects.toThrow();
        }
      });
      it("refuses a symbolic link in the selected skill before reading its destination", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        const root = await mkdtemp(join(tmpdir(), "scribe-skill-files-"));
        const Adapter = FileSystemAdapter as unknown as new (base: string) => FileSystemAdapter;
        try {
          await mkdir(join(root, ".scribe/skills/review"), { recursive: true });
          await writeFile(join(root, ".scribe/skills/review/SKILL.md"), CONTENT);
          await writeFile(join(root, "outside.md"), "Outside text");
          await symlink(join(root, "outside.md"), join(root, ".scribe/skills/review/guide.md"));
          fixture.app.vault.adapter = new Adapter(root);
          await expect(fixture.manager.readSkillFile(skill, "guide.md")).rejects.toThrow(
            "快捷链接"
          );
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
      it("refuses binary or invalid UTF-8 content instead of decoding a lossy editable copy", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        fixture.files.set(".scribe/skills/review/image.png", "\0binary");
        await expect(fixture.manager.readSkillFile(skill, "image.png")).rejects.toThrow("text");
        fixture.adapter.readBinary.mockResolvedValueOnce(new Uint8Array([0xff]).buffer);
        await expect(fixture.manager.readSkillFile(skill, "image.png")).rejects.toThrow("text");
      });
    });
    describe("saveSkillFile()", () => {
      it("saves a supporting file, refreshes its session signature and keeps the imported baseline", async () => {
        const fixture = setup();
        await fixture.manager.installPackage({
          name: "review",
          source: { kind: "local", origin: "/original/review" },
          files: [
            { path: "SKILL.md", data: new TextEncoder().encode(CONTENT) },
            { path: "guide.md", data: new TextEncoder().encode("Original guide") },
          ],
        });
        const skill = getManagedSkills()[0];
        const registry = fixture.files.get(".scribe/skills/.registry.json");
        const document = await fixture.manager.readContent(skill);
        const signature = computeSkillSetSignature([skill], "native");
        expect(
          await fixture.manager.saveSkillFile(skill, "guide.md", "New guide", "Original guide")
        ).toEqual({ ok: true });
        expect(await fixture.manager.readSkillFile(skill, "guide.md")).toBe("New guide");
        expect(fixture.files.get(skill.filePath)).toBe(document);
        expect(fixture.files.get(".scribe/skills/.registry.json")).toBe(registry);
        expect(computeSkillSetSignature(getManagedSkills(), "native")).not.toBe(signature);
      });
      it("updates the signature of an existing unregistered local skill after a supporting-file edit", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        fixture.files.set(".scribe/skills/review/guide.md", "Original");
        await fixture.manager.refresh();
        const signature = computeSkillSetSignature(getManagedSkills(), "native");
        expect(
          await fixture.manager.saveSkillFile(skill, "guide.md", "Edited", "Original")
        ).toEqual({ ok: true });
        expect(computeSkillSetSignature(getManagedSkills(), "native")).not.toBe(signature);
        expect(fixture.files.has(".scribe/skills/.registry.json")).toBe(false);
        expect(await fixture.manager.deleteSkill(getManagedSkills()[0])).toEqual({ ok: true });
      });
      it("renames a complete skill from raw SKILL.md while preserving its support files and unknown number text", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        fixture.files.set(".scribe/skills/review/guide.md", "Supporting text");
        const draft = CONTENT.replace("name: review", "name: renamed-review").replace(
          "metadata:",
          "unknown: 0.123456789012345678901234567890\nmetadata:"
        );
        expect(await fixture.manager.saveSkillFile(skill, "SKILL.md", draft, CONTENT)).toEqual({
          ok: true,
        });
        const renamed = getManagedSkills()[0];
        expect(renamed.name).toBe("renamed-review");
        expect(await fixture.manager.readContent(renamed)).toContain(
          "unknown: 0.123456789012345678901234567890"
        );
        expect(await fixture.manager.readSkillFile(renamed, "guide.md")).toBe("Supporting text");
        expect(fixture.files.has(skill.filePath)).toBe(false);
      });
      it("edits a lowercase root descriptor through its canonical alias without remapping nested skill.md files", async () => {
        const fixture = setup();
        const initial = await fixture.seed();
        fixture.files.delete(initial.filePath);
        fixture.files.set(".scribe/skills/review/skill.md", CONTENT);
        fixture.folders.add(".scribe/skills/review/references");
        fixture.files.set(".scribe/skills/review/references/skill.md", "Nested supporting text");
        await fixture.manager.refresh();
        const skill = getManagedSkills()[0];
        expect(skill.filePath).toBe(".scribe/skills/review/skill.md");
        expect(await fixture.manager.listSkillFiles(skill)).toEqual([
          "SKILL.md",
          "references/skill.md",
        ]);
        expect(await fixture.manager.readSkillFile(skill, "SKILL.md")).toBe(CONTENT);
        expect(await fixture.manager.readSkillFile(skill, "references/skill.md")).toBe(
          "Nested supporting text"
        );
        const renamed = CONTENT.replace("name: review", "name: renamed-review");
        expect(await fixture.manager.saveSkillFile(skill, "SKILL.md", renamed, CONTENT)).toEqual({
          ok: true,
        });
        const updated = getManagedSkills()[0];
        expect(updated.name).toBe("renamed-review");
        expect(updated.filePath).toBe(".scribe/skills/renamed-review/SKILL.md");
        expect(await fixture.manager.readSkillFile(updated, "SKILL.md")).toBe(renamed);
        expect(await fixture.manager.readSkillFile(updated, "references/skill.md")).toBe(
          "Nested supporting text"
        );
        expect(fixture.files.has(".scribe/skills/review/skill.md")).toBe(false);
      });
      it("keeps raw line endings and metadata blank lines so consecutive saves use the exact persisted baseline", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        const first = CONTENT.replace("\n---\nRead carefully.", "\n\n\n---\nFirst edit.").replace(
          /\n/g,
          "\r\n"
        );
        expect(await fixture.manager.saveSkillFile(skill, "SKILL.md", first, CONTENT)).toEqual({
          ok: true,
        });
        expect(await fixture.manager.readContent(getManagedSkills()[0])).toBe(first);
        const second = first.replace("First edit.", "Second edit.");
        expect(
          await fixture.manager.saveSkillFile(getManagedSkills()[0], "SKILL.md", second, first)
        ).toEqual({ ok: true });
        expect(await fixture.manager.readContent(getManagedSkills()[0])).toBe(second);
      });
      it("preserves a UTF-8 byte-order mark when reading and saving a supporting text file", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        const original = "\uFEFFSupporting text";
        fixture.files.set(".scribe/skills/review/guide.md", original);
        expect(await fixture.manager.readSkillFile(skill, "guide.md")).toBe(original);
        const edited = "\uFEFFEdited text";
        expect(await fixture.manager.saveSkillFile(skill, "guide.md", edited, original)).toEqual({
          ok: true,
        });
        expect(await fixture.manager.readSkillFile(skill, "guide.md")).toBe(edited);
        expect(fixture.files.get(".scribe/skills/review/guide.md")).toBe(edited);
      });
      it("saves raw enablement changes exactly and refreshes the global switch state", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        const disabled = CONTENT.replace(
          "scribe-enabled-agents: native",
          'scribe-enabled-agents: ""'
        );
        expect(await fixture.manager.saveSkillFile(skill, "SKILL.md", disabled, CONTENT)).toEqual({
          ok: true,
        });
        const saved = getManagedSkills()[0];
        expect(saved.enabledAgents).toEqual([]);
        expect(await fixture.manager.readContent(saved)).toBe(disabled);
        expect(await fixture.manager.saveSkillFile(saved, "SKILL.md", CONTENT, disabled)).toEqual({
          ok: true,
        });
        expect(getManagedSkills()[0].enabledAgents).toEqual(["native"]);
        expect(await fixture.manager.readContent(getManagedSkills()[0])).toBe(CONTENT);
      });
      it("keeps changed originals and rejects invalid raw descriptors or writes outside the selected skill", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        fixture.files.set(".scribe/skills/review/guide.md", "External change");
        expect(
          await fixture.manager.saveSkillFile(skill, "guide.md", "Draft", "Original")
        ).toMatchObject({ ok: false });
        expect(fixture.files.get(".scribe/skills/review/guide.md")).toBe("External change");
        expect(
          await fixture.manager.saveSkillFile(
            skill,
            "SKILL.md",
            CONTENT.replace("name: review", "name: Invalid Name"),
            CONTENT
          )
        ).toMatchObject({ ok: false });
        expect(
          await fixture.manager.saveSkillFile(skill, "../outside.md", "Draft", "Original")
        ).toMatchObject({ ok: false });
        expect(fixture.files.get(skill.filePath)).toBe(CONTENT);
      });
      it("keeps binary supporting files untouched when a text save is attempted", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        const original = "\0binary data";
        fixture.files.set(".scribe/skills/review/image.png", original);
        fixture.adapter.write.mockClear();
        expect(
          await fixture.manager.saveSkillFile(skill, "image.png", "Text draft", original)
        ).toMatchObject({ ok: false });
        expect(fixture.files.get(".scribe/skills/review/image.png")).toBe(original);
        expect(fixture.adapter.write).not.toHaveBeenCalled();
      });
      it("preserves a support file changed while staging or when writing fails", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        const path = ".scribe/skills/review/guide.md";
        fixture.files.set(path, "Original");
        fixture.adapter.write.mockImplementationOnce(async (staging, value) => {
          fixture.files.set(path, "External change");
          fixture.files.set(staging, value);
        });
        expect(
          await fixture.manager.saveSkillFile(skill, "guide.md", "Draft", "Original")
        ).toMatchObject({ ok: false });
        expect(fixture.files.get(path)).toBe("External change");
        fixture.adapter.write.mockRejectedValueOnce(new Error("disk full"));
        expect(
          await fixture.manager.saveSkillFile(skill, "guide.md", "Draft", "External change")
        ).toMatchObject({ ok: false });
        expect(fixture.files.get(path)).toBe("External change");
      });
      it("refuses builtin support edits even when the displayed source is forged as local", async () => {
        const fixture = setup();
        await fixture.manager.syncBuiltins();
        const skill = getManagedSkills().find((item) => item.name === "skill-creator")!;
        const original = await fixture.manager.readSkillFile(skill, "LICENSE.txt");
        expect(
          await fixture.manager.saveSkillFile(
            { ...skill, source: { kind: "local" } },
            "LICENSE.txt",
            "Changed",
            original
          )
        ).toMatchObject({ ok: false });
        expect(await fixture.manager.readSkillFile(skill, "LICENSE.txt")).toBe(original);
      });
    });
    describe("saveContent()", () => {
      it("retains enablement when editing the document and publishes the new body", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        expect(
          await fixture.manager.saveContent(
            skill,
            CONTENT.replace("Read carefully.", "New instructions.")
          )
        ).toEqual({ ok: true });
        expect(getManagedSkills()[0].body.trim()).toBe("New instructions.");
        expect(getManagedSkills()[0].enabledAgents).toEqual(["native"]);
      });
      it("preserves the saved content when staging fails", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        fixture.adapter.write.mockRejectedValueOnce(new Error("disk full"));
        expect(
          await fixture.manager.saveContent(skill, CONTENT.replace("Read carefully.", "Draft"))
        ).toMatchObject({ ok: false });
        expect(fixture.files.get(skill.filePath)).toBe(CONTENT);
      });
    });
    describe("toggleAgent()", () => {
      it("changes enablement in the skill document without creating or deleting links", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        expect(await fixture.manager.toggleAgent(skill, "native", false)).toEqual({ ok: true });
        expect(getManagedSkills()[0].enabledAgents).toEqual([]);
        expect(
          parseSkillFile(fixture.files.get(skill.filePath)!, "review").frontmatter.enabledAgents
        ).toEqual([]);
        expect([...fixture.files.keys()]).toEqual([skill.filePath]);
      });
      it("refuses an unavailable agent before writing", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        expect(await fixture.manager.toggleAgent(skill, "other", true)).toMatchObject({
          ok: false,
          code: "unknown-agent",
        });
        expect(fixture.adapter.write).not.toHaveBeenCalled();
      });
    });
    describe("saveProperties()", () => {
      it("renames the stored skill and saves its description without touching old folders", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        expect(
          await fixture.manager.saveProperties(skill, {
            newName: "review-notes",
            patch: { description: "Updated description" },
          })
        ).toEqual({ ok: true });
        expect(getManagedSkills()[0]).toMatchObject({
          name: "review-notes",
          description: "Updated description",
        });
        expect([...fixture.files.keys()]).toEqual([
          ".scribe/skills/review-notes/SKILL.md",
          ".scribe/skills/.registry.json",
        ]);
      });
    });
    describe("deleteSkill()", () => {
      it("preserves a skill changed while uninstall confirmation was pending", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        const changed = CONTENT.replace("Read carefully", "External instructions");
        fixture.files.set(skill.filePath, changed);
        expect(await fixture.manager.deleteSkill(skill)).toMatchObject({ ok: false });
        expect(fixture.files.get(skill.filePath)).toBe(changed);
      });
      it("deletes only the managed skill and preserves an old copy", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        fixture.files.set("old-skills/review/SKILL.md", CONTENT);
        expect(await fixture.manager.deleteSkill(skill)).toEqual({ ok: true });
        expect(getManagedSkills()).toEqual([]);
        expect([...fixture.files.keys()]).toEqual([
          "old-skills/review/SKILL.md",
          ".scribe/skills/.registry.json",
        ]);
      });
    });
    describe("subscribeToSkillSetChange()", () => {
      it("notifies after a visible change and stops notifying after unsubscribe", async () => {
        const fixture = setup();
        const changed = jest.fn();
        const unsubscribe = fixture.manager.subscribeToSkillSetChange(changed);
        const skill = await fixture.seed();
        await fixture.manager.refresh();
        expect(changed).toHaveBeenCalledTimes(1);
        unsubscribe();
        await fixture.manager.toggleAgent(skill, "native", false);
        expect(changed).toHaveBeenCalledTimes(1);
      });
    });
    describe("dispose()", () => {
      it("releases the singleton and permits a new manager", () => {
        const fixture = setup();
        fixture.manager.dispose();
        expect(SkillManager.hasInstance()).toBe(false);
        expect(() => SkillManager.getInstance()).toThrow();
        expect(SkillManager.initialize(fixture.app, {})).not.toBe(fixture.manager);
      });
    });
    describe("syncBuiltins()", () => {
      it("installs all seven complete builtin packages and preserves a personal name collision", async () => {
        const fixture = setup();
        fixture.folders.add(".scribe");
        fixture.folders.add(".scribe/skills");
        fixture.folders.add(".scribe/skills/json-canvas");
        const original = "---\nname: json-canvas\ndescription: My own skill\n---\nPersonal rules";
        fixture.files.set(".scribe/skills/json-canvas/SKILL.md", original);
        await fixture.manager.syncBuiltins();
        expect(getManagedSkills()).toHaveLength(7);
        expect(getManagedSkills().filter((skill) => skill.source?.kind === "builtin")).toHaveLength(
          6
        );
        expect(fixture.files.get(".scribe/skills/json-canvas/SKILL.md")).toBe(original);
        expect(fixture.manager.getBuiltinWarnings()).toContain("json-canvas");
      });
      it("does not reinstall an explicitly uninstalled builtin after synchronization", async () => {
        const fixture = setup();
        await fixture.manager.syncBuiltins();
        const skill = getManagedSkills().find((item) => item.name === "skill-creator")!;
        await fixture.manager.deleteSkill(skill);
        await fixture.manager.syncBuiltins();
        expect(getManagedSkills().some((item) => item.name === "skill-creator")).toBe(false);
      });
    });
    describe("getBuiltinStatuses()", () => {
      it("detects a changed support file without mistaking disablement for modification", async () => {
        const fixture = setup();
        await fixture.manager.syncBuiltins();
        const skill = getManagedSkills().find((item) => item.name === "skill-creator")!;
        await fixture.manager.toggleAgent(skill, "native", false);
        expect(
          (await fixture.manager.getBuiltinStatuses()).find((item) => item.name === skill.name)
            ?.status
        ).toBe("installed");
        fixture.files.set(".scribe/skills/skill-creator/LICENSE.txt", "external edit");
        expect(
          (await fixture.manager.getBuiltinStatuses()).find((item) => item.name === skill.name)
            ?.status
        ).toBe("modified");
      });
    });
    describe("restoreBuiltin()", () => {
      it("restores an uninstalled builtin as enabled without overwriting a personal collision", async () => {
        const fixture = setup();
        await fixture.manager.syncBuiltins();
        const skill = getManagedSkills().find((item) => item.name === "skill-creator")!;
        await fixture.manager.deleteSkill(skill);
        expect(await fixture.manager.restoreBuiltin(skill.name)).toEqual({ ok: true });
        expect(getManagedSkills().find((item) => item.name === skill.name)?.enabledAgents).toEqual([
          "native",
        ]);
        expect(await fixture.manager.restoreBuiltin("unknown")).toMatchObject({ ok: false });
      });
    });
    describe("saveSkill()", () => {
      it("refuses builtin edits even when the supplied row claims to be local", async () => {
        const fixture = setup();
        await fixture.manager.syncBuiltins();
        const skill = getManagedSkills()[0];
        const original = await fixture.manager.readContent(skill);
        expect(
          await fixture.manager.saveSkill(
            { ...skill, source: { kind: "local" } },
            original,
            skill.name,
            original
          )
        ).toMatchObject({ ok: false });
        expect(await fixture.manager.readContent(skill)).toBe(original);
      });
    });
    describe("installPackage()", () => {
      it("keeps raw-edited enablement when the same source is imported again", async () => {
        const fixture = setup();
        const pkg = {
          name: "review",
          source: { kind: "local" as const, origin: "/original/review" },
          files: [{ path: "SKILL.md", data: new TextEncoder().encode(CONTENT) }],
        };
        expect(await fixture.manager.installPackage(pkg)).toEqual({ ok: true });
        const skill = getManagedSkills()[0];
        const original = await fixture.manager.readContent(skill);
        const disabled = original.replace(
          "scribe-enabled-agents: native",
          'scribe-enabled-agents: ""'
        );
        expect(await fixture.manager.saveSkillFile(skill, "SKILL.md", disabled, original)).toEqual({
          ok: true,
        });
        expect(await fixture.manager.installPackage(pkg, true)).toEqual({ ok: true });
        expect(getManagedSkills()[0].enabledAgents).toEqual([]);
      });
      it("imports a local snapshot then requires confirmation to replace the same source", async () => {
        const fixture = setup();
        const pkg = {
          name: "review",
          source: { kind: "local" as const, origin: "/original/review" },
          files: [{ path: "SKILL.md", data: new TextEncoder().encode(CONTENT) }],
        };
        expect(await fixture.manager.installPackage(pkg)).toEqual({ ok: true });
        expect(await fixture.manager.installPackage(pkg)).toMatchObject({
          ok: false,
          code: "collision",
        });
        expect(await fixture.manager.installPackage(pkg, true)).toEqual({ ok: true });
      });
    });
    describe("resolveCanonicalNameForMigration()", () => {
      it("chooses an available name using only current managed skills", async () => {
        const fixture = setup();
        await fixture.seed();
        expect(fixture.manager.resolveCanonicalNameForMigration("review")).not.toBe("review");
      });
    });
    describe("getSuppressMigrationConfirm()", () => {
      it("reads the retained lightweight preference", () => {
        expect(setup().manager.getSuppressMigrationConfirm()).toBe(false);
      });
    });
    describe("setSuppressMigrationConfirm()", () => {
      it("saves the retained lightweight preference without touching files", () => {
        setup().manager.setSuppressMigrationConfirm(true);
        expect(updateSetting).toHaveBeenCalledWith(
          "agentMode",
          expect.objectContaining({ skills: { suppressMigrationConfirm: true } })
        );
        expect(getSettings).toHaveBeenCalled();
      });
    });
    describe("migrateProjectSkillForToggle()", () => {
      it("declines old skill imports without reading their files", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        fixture.adapter.read.mockClear();
        expect(
          await fixture.manager.migrateProjectSkillForToggle(skill, "native", "expandToNewAgent")
        ).toMatchObject({ ok: false });
        expect(fixture.adapter.read).not.toHaveBeenCalled();
      });
    });
    describe("consolidateMirroredSkill()", () => {
      it("does not consolidate old copies", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        expect(await fixture.manager.consolidateMirroredSkill(skill, false)).toMatchObject({
          ok: false,
        });
      });
    });
    describe("removeProjectAgentDir()", () => {
      it("leaves old agent directories alone", async () => {
        const fixture = setup();
        const skill = await fixture.seed();
        expect(await fixture.manager.removeProjectAgentDir(skill, "native")).toMatchObject({
          ok: false,
        });
        expect(fixture.files.has(skill.filePath)).toBe(true);
      });
    });
  });
  describe("computeSkillSetSignature()", () => {
    it("returns a stable signature for unchanged skills and changes it for edited content", async () => {
      const fixture = setup();
      const skill = await fixture.seed();
      expect(computeSkillSetSignature([], "native")).toBe("skills:v1:0");
      expect(computeSkillSetSignature([skill], "native")).toBe(
        computeSkillSetSignature([skill], "native")
      );
      expect(computeSkillSetSignature([skill], "native")).not.toBe(
        computeSkillSetSignature([{ ...skill, body: "Changed" }], "native")
      );
    });
  });
});
