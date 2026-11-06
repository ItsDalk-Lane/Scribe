import type { ProjectConfig } from "@/aiParams";
import {
  loadAllProjects,
  parseProjectConfigFile,
  scanAllProjectConfigFiles,
  serializeProjectConfig,
} from "@/projects/projectUtils";
import { getCachedProjectRecords, updateCachedProjectRecords } from "@/projects/state";
import { parseYaml, type App } from "obsidian";

jest.mock("@/settings/scribeFolder", () => ({
  getEffectiveProjectsFolder: () => ".scribe/projects",
}));
jest.mock("@/logger", () => ({ logWarn: jest.fn() }));
const configuration: ProjectConfig = {
  id: "research",
  name: "Research",
  workspacePath: "",
  description: "Sources",
  systemPrompt: "User text",
  contextSource: {
    inclusions: "Notes/",
    exclusions: "Drafts/",
    webUrls: "https://example.com",
    youtubeUrls: "",
  },
  created: 10,
  UsageTimestamps: 20,
};
const filePath = ".scribe/projects/research/project.md";

function memoryApp(content: string): App {
  return {
    vault: {
      configDir: ".custom-config",
      adapter: {
        exists: async () => true,
        list: async () => ({ folders: [".scribe/projects/research"], files: [] }),
        read: async () => content,
      },
    },
  } as unknown as App;
}

describe("projectUtils", () => {
  afterEach(() => updateCachedProjectRecords([]));
  describe("serializeProjectConfig()", () => {
    it("preserves unknown saved metadata when updating a project's owned fields", () => {
      const before = serializeProjectConfig(configuration).replace(
        "\n---",
        "\nfuture: {nested: [1, {keep: true}]}\n---"
      );
      const changed = serializeProjectConfig({ ...configuration, name: "Renamed" }, before);
      const data = parseYaml(changed.match(/^---\n([\s\S]*?)\n---/)![1]) as Record<string, unknown>;
      expect(data.future).toEqual({ nested: [1, { keep: true }] });
      expect(data["scribe-project-name"]).toBe("Renamed");
    });
    it("refuses an update if external edits removed the configuration header", () => {
      expect(() =>
        serializeProjectConfig(configuration, "Unrecognized external content")
      ).toThrow();
    });

    it("writes the explicit root workspace and keeps user text intact", () => {
      const encoded = serializeProjectConfig(configuration);
      expect(encoded).toContain('scribe-project-workspace: ""');
      expect(encoded.endsWith("---\nUser text")).toBe(true);
    });
  });
  describe("parseProjectConfigFile()", () => {
    it("round-trips the new hidden project format without relying on cached file metadata", async () => {
      const record = await parseProjectConfigFile(
        memoryApp(serializeProjectConfig(configuration)),
        filePath
      );
      expect(record?.project).toEqual(configuration);
    });
    it("rejects a record without an explicit workspace instead of guessing one from its configuration path", async () => {
      expect(
        await parseProjectConfigFile(
          memoryApp("---\nscribe-project-id: research\nscribe-project-name: Research\n---\n"),
          filePath
        )
      ).toBeNull();
    });
    it("rejects records stored under another project's identity", async () => {
      expect(
        await parseProjectConfigFile(
          memoryApp(serializeProjectConfig({ ...configuration, id: "another" })),
          filePath
        )
      ).toBeNull();
    });
  });
  describe("scanAllProjectConfigFiles()", () => {
    it("enumerates hidden project directories and returns their saved workspace", async () => {
      expect(
        (await scanAllProjectConfigFiles(memoryApp(serializeProjectConfig(configuration))))[0]
          .project.workspacePath
      ).toBe("");
    });
  });
  describe("loadAllProjects()", () => {
    it("publishes the loaded projects to the visible project list", async () => {
      const loaded = await loadAllProjects(memoryApp(serializeProjectConfig(configuration)));
      expect(getCachedProjectRecords()).toEqual(loaded);
      expect(loaded).toHaveLength(1);
    });
  });
});
