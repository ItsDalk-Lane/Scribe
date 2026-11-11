import { FileSystemAdapter, TFolder, type App } from "obsidian";
import nodePath from "node:path";

jest.mock("@/projects/state", () => ({
  getCachedProjectRecordById: jest.fn(),
}));
jest.mock(
  "@/search/searchUtils",
  (): Record<string, unknown> => ({
    ...jest.requireActual("@/search/searchUtils"),
    shouldIndexFile: jest.fn(() => true),
  })
);

import { getCachedProjectRecordById } from "@/projects/state";
import { createPatternSettingsValue, shouldIndexFile } from "@/search/searchUtils";
import {
  buildCurrentProjectContext,
  buildProjectContext,
  buildProjectContextBlock,
  MAX_MANIFEST_ENTRIES,
  PROJECT_WORKSPACE_POLICY,
  type ManifestPathEntry,
  type ManifestSources,
} from "./manifestBuilder";

const getRecord = getCachedProjectRecordById as jest.Mock;
const indexFile = shouldIndexFile as jest.Mock;

function vaultAbs(...parts: string[]): string {
  return nodePath.join("/vault", ...parts);
}

function abs(vaultPath: string, absPath?: string): ManifestPathEntry {
  return absPath ? { vaultPath, absPath } : { vaultPath };
}

function sources(over: Partial<ManifestSources> = {}): ManifestSources {
  return {
    folders: [],
    notes: [],
    extensions: [],
    tags: [],
    properties: [],
    propertyNotes: [],
    documents: [],
    webUrls: [],
    youtubeUrls: [],
    exclusions: [],
    ...over,
  };
}

function record(
  contextSource: Record<string, string | undefined>,
  id = "p1",
  workspacePath = "Proj"
) {
  return {
    project: { id, contextSource, workspacePath },
    filePath: "Proj/AGENTS.md",
    folderName: "Proj",
  };
}

function fakeApp(files: Array<{ path: string; ext: string }> = [], folders: string[] = []): App {
  const tfiles = files.map((f) => ({
    path: f.path,
    extension: f.ext,
    basename: f.path
      .split("/")
      .pop()!
      .replace(/\.[^.]+$/, ""),
    stat: { mtime: 1000, size: 10 },
  }));
  const folderSet = new Set(folders);
  const FsAdapter = FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter;
  const Folder = TFolder as unknown as new (path: string) => TFolder;
  return {
    vault: {
      adapter: new FsAdapter("/vault"),
      getFiles: () => tfiles,
      getMarkdownFiles: () => tfiles.filter((f) => f.extension === "md"),
      getAbstractFileByPath: (p: string) => (folderSet.has(p) ? new Folder(p) : null),
    },
  } as unknown as App;
}

beforeEach(() => {
  jest.clearAllMocks();
  indexFile.mockReturnValue(true);
});

describe("manifestBuilder", () => {
  describe("buildCurrentProjectContext()", () => {
    it("uses the current project sources and explicitly replaces prior declarations without granting permissions", () => {
      getRecord.mockReturnValue(record({ webUrls: "https://current.example" }));
      const block = buildCurrentProjectContext(fakeApp(), "p1");
      expect(block).toContain("https://current.example");
      expect(block).toContain("replaces all earlier project source declarations");
      expect(block).toContain("regardless of their position in retained history or summaries");
      expect(block).toContain("do not grant permission");
    });

    it("reports an unavailable project without replacing the last known sources or claiming an empty selection", () => {
      getRecord.mockReturnValue(undefined);
      const block = buildCurrentProjectContext(fakeApp(), "missing");
      expect(block).toContain("could not be loaded");
      expect(block).toContain("not an empty selection");
      expect(block).not.toContain("replaces all earlier project source declarations");
      expect(block).not.toContain("No context sources are configured");
    });

    it("reminds the model to re-read source contents instead of treating previously read material as current", () => {
      getRecord.mockReturnValue(record({ webUrls: "https://current.example" }));
      expect(buildCurrentProjectContext(fakeApp(), "p1")).toContain(
        "Previously read source contents may be outdated; re-read sources before relying on their current contents."
      );
    });

    it("rebuilds replaced and cleared source selections instead of retaining earlier sources", () => {
      getRecord.mockReturnValue(record({ webUrls: "https://old.example" }));
      expect(buildCurrentProjectContext(fakeApp(), "p1")).toContain("https://old.example");
      getRecord.mockReturnValue(record({ webUrls: "https://new.example" }));
      const replaced = buildCurrentProjectContext(fakeApp(), "p1");
      expect(replaced).toContain("https://new.example");
      expect(replaced).not.toContain("https://old.example");
      getRecord.mockReturnValue(record({}));
      const cleared = buildCurrentProjectContext(fakeApp(), "p1");
      expect(cleared).toContain("No context sources are configured");
      expect(cleared).not.toContain("https://new.example");
      expect(cleared).toContain("replaces all earlier project source declarations");
    });
  });

  describe("buildProjectContext", () => {
    it("includes the original exclusion selection alongside the current source selection", () => {
      getRecord.mockReturnValue(
        record({
          inclusions: "Notes",
          exclusions: ["Notes/private", "#restricted", "[[Draft]]"]
            .map(encodeURIComponent)
            .join(","),
        })
      );
      const block = buildProjectContext(fakeApp(), "p1");
      expect(block).toContain(
        "## Excluded source selections\n- Notes/private\n- #restricted\n- [[Draft]]"
      );
    });

    it("decodes saved exclusion selections without splitting Chinese, comma or newline characters inside a path", () => {
      const selections = ["私有/项目", "Notes/Review, Later", "Notes/Line\nBreak"];
      getRecord.mockReturnValue(
        record({
          inclusions: "Notes",
          exclusions: createPatternSettingsValue({ folderPatterns: selections }),
        })
      );
      const block = buildProjectContext(fakeApp(), "p1");
      expect(block).toContain(
        `## Excluded source selections\n${selections.map((selection) => `- ${selection}`).join("\n")}`
      );
      expect(block).not.toContain("%2F");
      expect(block).not.toContain("%2C");
      expect(block).not.toContain("%0A");
    });

    it("retains exclusions when no inclusion is configured", () => {
      getRecord.mockReturnValue(record({ exclusions: "Private" }));
      expect(buildProjectContext(fakeApp(), "p1")).toContain(
        "## Excluded source selections\n- Private"
      );
    });

    it("resolves fifty selected titles in one vault scan while preserving every selected note", () => {
      const noteCount = 10_000;
      const selectedTitles = Array.from({ length: 50 }, (_, index) => `Topic${index}`);
      getRecord.mockReturnValue(
        record({ inclusions: selectedTitles.map((title) => `[[${title}]]`).join(",") })
      );
      const app = fakeApp(
        Array.from({ length: noteCount }, (_, index) => ({
          path: `Notes/Topic${index}.md`,
          ext: "md",
        }))
      );
      let basenameReads = 0;
      for (const file of app.vault.getFiles()) {
        const basename = file.basename;
        Object.defineProperty(file, "basename", {
          get: () => {
            basenameReads++;
            return basename;
          },
        });
      }
      const listFiles = jest.spyOn(app.vault, "getFiles");
      const block = buildProjectContext(app, "p1");
      for (const title of selectedTitles)
        expect(block).toContain(`\`${vaultAbs("Notes", `${title}.md`)}\``);
      expect(basenameReads).toBe(noteCount);
      expect(listFiles).toHaveBeenCalledTimes(1);
    });

    it("lists included notes by absolute path in the context block", () => {
      getRecord.mockReturnValue(record({ inclusions: "[[Spec]]" }));
      const app = fakeApp([{ path: "Notes/Spec.md", ext: "md" }]);

      const block = buildProjectContext(app, "p1");

      expect(block).toContain("## Included notes");
      expect(block).toContain(`\`${vaultAbs("Notes", "Spec.md")}\``);
    });

    it("rebuilds selected note paths after a move or rename without retaining a prior lookup", () => {
      getRecord.mockReturnValue(record({ inclusions: "[[Spec]]" }));
      const app = fakeApp([{ path: "Drafts/Spec.md", ext: "md" }]);
      const note = app.vault.getFiles()[0];
      expect(buildProjectContext(app, "p1")).toContain(`\`${vaultAbs("Drafts", "Spec.md")}\``);
      note.path = "Published/Spec.md";
      const moved = buildProjectContext(app, "p1");
      expect(moved).toContain(`\`${vaultAbs("Published", "Spec.md")}\``);
      expect(moved).not.toContain("Drafts/Spec.md");
      note.path = "Published/Outline.md";
      note.basename = "Outline";
      const renamed = buildProjectContext(app, "p1");
      expect(renamed).toContain("`[[Spec]]`");
      expect(renamed).not.toContain("Published/Spec.md");
      getRecord.mockReturnValue(record({ inclusions: "[[Outline]]" }));
      expect(buildProjectContext(app, "p1")).toContain(
        `\`${vaultAbs("Published", "Outline.md")}\``
      );
    });

    it("splits the saved web and YouTube URL settings into one link per line", () => {
      getRecord.mockReturnValue(
        record({ webUrls: "https://example.com\n", youtubeUrls: "https://youtu.be/abc" })
      );

      const block = buildProjectContext(fakeApp(), "p1");

      expect(block).toContain("## Included URLs\n- https://example.com");
      expect(block).toContain("## Included YouTube\n- https://youtu.be/abc");
    });

    it("lists every note that shares an inclusion title (basename collision)", () => {
      getRecord.mockReturnValue(record({ inclusions: "[[Spec]]" }));
      const app = fakeApp([
        { path: "A/Spec.md", ext: "md" },
        { path: "B/Spec.md", ext: "md" },
      ]);

      const block = buildProjectContext(app, "p1");

      expect(block).toContain(`\`${vaultAbs("A", "Spec.md")}\``);
      expect(block).toContain(`\`${vaultAbs("B", "Spec.md")}\``);
    });

    it("does not advertise a selected title in an excluded folder as an included source https://github.com/ItsDalk-Lane/Scribe/issues/71", () => {
      indexFile.mockImplementation(
        jest.requireActual<typeof import("@/search/searchUtils")>("@/search/searchUtils")
          .shouldIndexFile
      );
      getRecord.mockReturnValue(record({ inclusions: "[[Spec]]", exclusions: "Private" }));
      const app = fakeApp([
        { path: "Shared/Spec.md", ext: "md" },
        { path: "Private/Spec.md", ext: "md" },
      ]);
      const block = buildProjectContext(app, "p1");
      expect(block).toContain(`\`${vaultAbs("Shared", "Spec.md")}\``);
      expect(block).not.toContain(vaultAbs("Private", "Spec.md"));

      getRecord.mockReturnValue(record({ inclusions: "[[Spec]]", exclusions: "[[Spec]]" }));
      const entirelyExcluded = buildProjectContext(app, "p1");
      expect(entirelyExcluded).not.toContain("## Included notes");
      expect(entirelyExcluded).toContain("## Excluded source selections\n- [[Spec]]");
    });

    it("counts a property-only inclusion as a source and enumerates matching notes by absolute path", () => {
      getRecord.mockReturnValue(record({ inclusions: "[Topics:Physics]" }));
      const app = fakeApp([
        { path: "Notes/Relativity.md", ext: "md" },
        { path: "Notes/Cooking.md", ext: "md" },
      ]);
      indexFile.mockImplementation((_app: unknown, file: { path: string }) => file.path === "Notes/Relativity.md"); // prettier-ignore

      const block = buildProjectContext(app, "p1");

      expect(block).toContain("## Notes matching an included property");
      expect(block).toContain(`\`${vaultAbs("Notes", "Relativity.md")}\``);
      expect(block).not.toContain("Cooking");
    });

    it("lists a note reached by both a title and a property once, as a declaration", () => {
      getRecord.mockReturnValue(record({ inclusions: "[[Relativity]],[Topics:Physics]" }));
      const app = fakeApp([{ path: "Notes/Relativity.md", ext: "md" }]);

      const block = buildProjectContext(app, "p1");

      expect(block.split(vaultAbs("Notes", "Relativity.md")).length - 1).toBe(1);
      expect(block).toContain("## Included notes");
      expect(block).not.toContain("## Notes matching an included property");
    });

    it("lists in-vault document files by their original absolute path", () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj" }));
      const app = fakeApp([
        { path: "Proj/a.pdf", ext: "pdf" },
        { path: "Notes/brief.DOCX", ext: "DOCX" },
        { path: "Proj/note.md", ext: "md" },
      ]);

      const block = buildProjectContext(app, "p1");

      expect(block).toContain("## Document files");
      expect(block).toContain(`- \`${vaultAbs("Proj", "a.pdf")}\``);
      expect(block).toContain(`- \`${vaultAbs("Notes", "brief.DOCX")}\``);
      expect(block).not.toContain("note.md");
    });

    it("lists only PDF, Office, EPUB and image files under Document files, sorted by path", () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj" }));
      const app = fakeApp([
        { path: "Proj/z.png", ext: "png" },
        { path: "Proj/data.csv", ext: "csv" },
        { path: "Proj/b.DOCX", ext: "DOCX" },
        { path: "Proj/a.pdf", ext: "pdf" },
        { path: "Proj/book.epub", ext: "epub" },
      ]);

      const block = buildProjectContext(app, "p1");

      expect(block).toContain(
        `## Document files\n- \`${vaultAbs("Proj", "a.pdf")}\`\n- \`${vaultAbs(
          "Proj",
          "b.DOCX"
        )}\`\n- \`${vaultAbs("Proj", "book.epub")}\`\n- \`${vaultAbs("Proj", "z.png")}\``
      );
      expect(block).not.toContain("data.csv");
    });

    it("leaves out document files the project's exclusions match", () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj", exclusions: "Proj/secret.pdf" }));
      indexFile.mockImplementation((_app: unknown, file: { path: string }) => file.path !== "Proj/secret.pdf"); // prettier-ignore
      const app = fakeApp([
        { path: "Proj/a.pdf", ext: "pdf" },
        { path: "Proj/secret.pdf", ext: "pdf" },
      ]);

      const block = buildProjectContext(app, "p1");

      expect(block).toContain(`\`${vaultAbs("Proj", "a.pdf")}\``);
      expect(block).not.toContain(`\`${vaultAbs("Proj", "secret.pdf")}\``);
      expect(block).toContain("## Excluded source selections\n- Proj/secret.pdf");
    });

    it("lists a document picked as a file once, under Included notes, so it does not spend a second manifest entry", () => {
      getRecord.mockReturnValue(record({ inclusions: "[[report]]" }));
      const app = fakeApp([{ path: "Docs/report.pdf", ext: "pdf" }]);

      const block = buildProjectContext(app, "p1");

      expect(block.split(vaultAbs("Docs", "report.pdf")).length - 1).toBe(1);
      expect(block).toContain("## Included notes");
      expect(block).not.toContain("## Document files");
    });

    it("keeps a project with only document files out of the empty-context block", () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj" }));
      const app = fakeApp([{ path: "Proj/scan.png", ext: "png" }]);

      const block = buildProjectContext(app, "p1");

      expect(block).not.toContain("No context sources are configured");
      expect(block).toContain(`\`${vaultAbs("Proj", "scan.png")}\``);
    });

    it("still emits <project_context> for a property-only project when no note currently matches", () => {
      getRecord.mockReturnValue(record({ inclusions: "[Topics:Physics]" }));
      indexFile.mockReturnValue(false);

      const block = buildProjectContext(fakeApp([{ path: "Notes/Cooking.md", ext: "md" }]), "p1"); // prettier-ignore

      expect(block).toContain("<project_context>");
      expect(block).toContain("## Included properties");
      expect(block).not.toContain("## Included notes");
    });

    it("lists folder inclusions by absolute path, inside or outside the working directory", () => {
      getRecord.mockReturnValue(record({ inclusions: "External,Proj/Sub" }));
      const app = fakeApp([], ["External", "Proj/Sub"]);

      const block = buildProjectContext(app, "p1");

      expect(block).toContain(`\`${vaultAbs("External")}\``);
      expect(block).toContain(`\`${vaultAbs("Proj", "Sub")}\``);
    });

    it("emits the no-sources block when the project has no context sources", () => {
      getRecord.mockReturnValue(record({}));

      expect(buildProjectContext(fakeApp(), "p1")).toContain("No context sources are configured");
    });

    it("gives vault file tools the exact project output path even with no selected sources https://github.com/ItsDalk-Lane/Scribe/issues/71", () => {
      getRecord.mockReturnValue(record({}, "p1", "Projects/Research"));
      const block = buildProjectContext(fakeApp(), "p1");
      expect(block).toContain(
        'Default output path for vault file tools: "Projects/Research/outputs/".'
      );
      expect(block).toContain("Vault file tools resolve relative paths from the vault root.");
      getRecord.mockReturnValue(record({ inclusions: "Sources" }, "p1", ""));
      expect(buildProjectContext(fakeApp(), "p1")).toContain(
        'Default output path for vault file tools: "outputs/".'
      );
    });

    it("returns the unavailable-context block when the project is unknown", () => {
      getRecord.mockReturnValue(undefined);

      expect(buildProjectContext(fakeApp(), "missing")).toContain("could not be loaded");
    });

    it("tells a project chat to save generated files to outputs/ even when the project has no sources or cannot be loaded", () => {
      getRecord.mockReturnValue(record({}));
      const noSources = buildProjectContext(fakeApp(), "p1");
      getRecord.mockReturnValue(undefined);
      const unavailable = buildProjectContext(fakeApp(), "missing");

      expect(noSources).toContain(PROJECT_WORKSPACE_POLICY);
      expect(unavailable).toContain(PROJECT_WORKSPACE_POLICY);
    });
  });

  describe("buildProjectContextBlock", () => {
    it("wraps the listing in a <project_context> block", () => {
      const md = buildProjectContextBlock(sources({ tags: ["#research"] }));
      expect(md.startsWith("<project_context>")).toBe(true);
      expect(md.endsWith("</project_context>")).toBe(true);
    });

    it("states the outputs/ workspace policy ahead of the source listing, so the entry cap never drops it", () => {
      const md = buildProjectContextBlock(sources({ tags: ["#research"] }));

      expect(md.startsWith(`<project_context>\n${PROJECT_WORKSPACE_POLICY}\n`)).toBe(true);
      expect(md.indexOf(PROJECT_WORKSPACE_POLICY)).toBeLessThan(md.indexOf("## Included tags"));
    });

    it("lists folders and notes by absolute path without expanding members", () => {
      const md = buildProjectContextBlock(
        sources({
          folders: [abs("Papers", "/vault/Papers")],
          tags: ["#research"],
          extensions: ["*.pdf"],
          notes: [abs("Notes/Spec.md", "/vault/Notes/Spec.md")],
        })
      );

      expect(md).toContain("## Included folders");
      expect(md).toContain("`/vault/Papers`");
      expect(md).toContain("## Included notes");
      expect(md).toContain("`/vault/Notes/Spec.md`");
      expect(md).toContain("## Included tags");
      expect(md).toContain("#research");
      expect(md).toContain("`*.pdf`");
      expect(md).not.toMatch(/Papers\/\S+\.md/);
    });

    it("lists web and YouTube sources as plain links under their own sections", () => {
      const url = "https://youtu.be/abc";
      const md = buildProjectContextBlock(sources({ webUrls: [url], youtubeUrls: [url] }));

      expect(md).toContain(`## Included URLs\n- ${url}`);
      expect(md).toContain(`## Included YouTube\n- ${url}`);
      expect(md).not.toContain("→");
    });

    it("falls back to the vault path when a source has no absolute path", () => {
      const md = buildProjectContextBlock(
        sources({ folders: [abs("Missing/")], notes: [abs("[[Ghost]]")] })
      );
      expect(md).toContain("`Missing/`");
      expect(md).toContain("`[[Ghost]]`");
    });

    it("lists a property inclusion as a source label", () => {
      const md = buildProjectContextBlock(sources({ properties: ["[Topics:Physics]"] }));
      expect(md).toContain("Included properties");
      expect(md).toContain("[Topics:Physics]");
    });

    it("lists property-matched notes under their own heading", () => {
      const md = buildProjectContextBlock(
        sources({ properties: ["[Topics:Physics]"], propertyNotes: [abs("p.md", "/vault/p.md")] })
      );
      expect(md).toContain("## Notes matching an included property");
      expect(md).toContain("`/vault/p.md`");
    });

    it("lists document files by the absolute path of the original file under their own section", () => {
      const md = buildProjectContextBlock(
        sources({
          documents: [
            abs("Papers/a.pdf", "/vault/Papers/a.pdf"),
            abs("Slides/deck.pptx", "/vault/Slides/deck.pptx"),
          ],
        })
      );

      expect(md).toContain(
        "## Document files\n- `/vault/Papers/a.pdf`\n- `/vault/Slides/deck.pptx`"
      );
    });

    it("omits the truncation note when under the cap", () => {
      const md = buildProjectContextBlock(sources({ folders: [abs("A"), abs("B")] }));
      expect(md).not.toContain("not listed");
    });

    it("keeps every explicit source category and exclusion even when declarations alone exceed the expansion cap", () => {
      const folders = Array.from({ length: MAX_MANIFEST_ENTRIES + 25 }, (_, i) =>
        abs(`Folder${i}`)
      );
      const md = buildProjectContextBlock(
        sources({
          folders,
          properties: ["[Subject:]"],
          notes: [abs("Last.md")],
          extensions: ["*.pdf"],
          tags: ["#research"],
          webUrls: ["https://current.example"],
          youtubeUrls: ["https://youtu.be/current"],
          exclusions: ["Private"],
        })
      );
      for (const folder of folders) expect(md).toContain(`\`${folder.vaultPath}\``);
      for (const value of [
        "[Subject:]",
        "Last.md",
        "*.pdf",
        "#research",
        "https://current.example",
        "https://youtu.be/current",
        "Private",
      ])
        expect(md).toContain(value);
      expect(md).not.toContain("not listed");
    });

    it("limits automatically expanded entries and reports their exact omitted count", () => {
      const documents = Array.from({ length: MAX_MANIFEST_ENTRIES + 25 }, (_, i) =>
        abs(`p${i}.pdf`)
      );
      const md = buildProjectContextBlock(sources({ documents }));
      expect(documents.filter((entry) => md.includes(`\`${entry.vaultPath}\``))).toHaveLength(
        MAX_MANIFEST_ENTRIES
      );
      expect(md).toContain(
        "> 25 more expanded sources are not listed; search the declared sources above for them."
      );
    });

    it("keeps every declared source when property-matched notes overflow the entry cap", () => {
      const many = Array.from({ length: MAX_MANIFEST_ENTRIES + 20 }, (_, i) => abs(`n${i}.md`));
      const md = buildProjectContextBlock(
        sources({
          propertyNotes: many,
          properties: ["[Subject:]"],
          folders: [abs("Papers", "/vault/Papers")],
          notes: [abs("Spec.md", "/vault/Spec.md")],
          extensions: ["*.pdf"],
          tags: ["#physics"],
          webUrls: ["https://a.com"],
          youtubeUrls: ["https://youtu.be/abc"],
        })
      );

      expect(md).toContain("[Subject:]");
      expect(md).toContain("`/vault/Papers`");
      expect(md).toContain("`/vault/Spec.md`");
      expect(md).toContain("`*.pdf`");
      expect(md).toContain("#physics");
      expect(md).toContain("https://a.com");
      expect(md).toContain("https://youtu.be/abc");
    });

    it("keeps a declared note when document file rows overflow the entry cap", () => {
      const documents = Array.from({ length: MAX_MANIFEST_ENTRIES + 20 }, (_, i) =>
        abs(`Papers/p${i}.pdf`, `/vault/Papers/p${i}.pdf`)
      );
      const md = buildProjectContextBlock(
        sources({
          documents,
          folders: [abs("Papers", "/vault/Papers")],
          notes: [abs("Outside/Spec.md", "/elsewhere/Outside/Spec.md")],
          tags: ["#physics"],
        })
      );

      expect(md).toContain("`/elsewhere/Outside/Spec.md`");
      expect(md).toContain("#physics");
      expect(md).toContain("`/vault/Papers`");
    });

    it("gives expanded entries their own limit independently of explicit source declarations", () => {
      const many = Array.from({ length: 120 }, (_, i) => abs(`n${i}.md`));
      const md = buildProjectContextBlock(
        sources({
          propertyNotes: many,
          properties: ["[Subject:]"],
          folders: [abs("Papers", "/vault/Papers")],
          extensions: ["*.pdf"],
          tags: ["#physics"],
          webUrls: ["https://a.com"],
        })
      );

      const listed = many.filter((note) => md.includes(`\`${note.vaultPath}\``));
      expect(listed).toHaveLength(MAX_MANIFEST_ENTRIES);
      expect(md).toContain("20 more expanded sources are not listed");
    });
  });
});
