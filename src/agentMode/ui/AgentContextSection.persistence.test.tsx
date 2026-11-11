import * as disk from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppContext } from "@/context";
import type { ProjectConfig } from "@/aiParams";
import AgentContextSection from "@/agentMode/ui/AgentContextSection";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import {
  getCachedProjectRecordById,
  updateCachedProjectRecords,
  upsertCachedProjectRecord,
} from "@/projects/state";
import { setInterfaceLocale } from "@/lib/i18n";
import type { App } from "obsidian";
import { FileSystemAdapter, Notice, parseYaml } from "obsidian";
import { serializeProjectConfig } from "@/projects/projectUtils";

interface OpenedModal {
  close: jest.Mock;
}
const mockOpenedModals: OpenedModal[] = [];

jest.mock("obsidian", () => {
  const original = jest.requireActual("obsidian");
  return {
    ...original,
    Modal: class {
      contentEl = document.createElement("div");
      modalEl = document.createElement("div");
      constructor(public app: App) {
        this.modalEl.appendChild(this.contentEl);
      }
      onOpen() {}
      onClose() {}
      open() {
        document.body.appendChild(this.modalEl);
        mockOpenedModals.push(this);
        this.onOpen();
      }
      close = jest.fn(() => {
        this.onClose();
        this.modalEl.remove();
      });
    },
  };
});
jest.mock("@/logger", () => ({ logWarn: jest.fn(), logInfo: jest.fn(), logError: jest.fn() }));
jest.mock("react-resizable-panels", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Group: Container, Panel: Container, Separator: Container };
});

const FAILURE = "Failed to save project context. Check the result and try again.";
const NEW_URL = "https://example.test/new-reference";

async function fixture() {
  const root = await disk.mkdtemp(join(tmpdir(), "scribe-project-save-status-"));
  const filePath = ".scribe/projects/project-id/project.md";
  const path = join(root, filePath);
  const project: ProjectConfig = {
    id: "project-id",
    name: "Project",
    workspacePath: "Research",
    systemPrompt: "Original instructions\n",
    contextSource: { webUrls: "https://example.test/original" },
    created: 1,
    UsageTimestamps: 1,
  };
  const original = serializeProjectConfig(project).replace(
    "\n---",
    "\nfuture: {nested: [1, {keep: true}]}\n---"
  );
  await disk.mkdir(join(root, ".scribe/projects/project-id"), { recursive: true });
  await disk.writeFile(path, original);
  let fail = true;
  let release: (() => void) | undefined;
  let pending: Promise<void> | undefined;
  const write = jest.fn(async (candidate: string, content: string) => {
    if (pending) await pending;
    if (fail) throw new Error("Controlled save failure");
    await disk.writeFile(join(root, candidate), content);
  });
  const adapter = new (FileSystemAdapter as unknown as new (root: string) => FileSystemAdapter)(
    root
  );
  Object.assign(adapter, {
    exists: async (candidate: string) =>
      disk.access(join(root, candidate)).then(
        () => true,
        () => false
      ),
    read: (candidate: string) => disk.readFile(join(root, candidate), "utf8"),
    write,
    rename: (from: string, to: string) => disk.rename(join(root, from), join(root, to)),
    remove: (candidate: string) => disk.unlink(join(root, candidate)),
  });
  const app = {
    vault: {
      adapter,
      configDir: ".custom-config",
      getFiles: () => [],
      getAbstractFileByPath: () => null,
    },
    metadataCache: { getFileCache: () => null },
    workspace: { getActiveFile: () => null },
  } as unknown as App;
  updateCachedProjectRecords([{ project, filePath, folderName: "Project" }]);
  render(
    <AppContext.Provider value={app}>
      <AgentContextSection app={app} projectId={project.id} />
    </AppContext.Provider>
  );
  return {
    project,
    original,
    writeAdapter: write,
    read: () => disk.readFile(path, "utf8"),
    write: (text: string) => disk.writeFile(path, text),
    allowSaving: () => {
      fail = false;
    },
    holdSaving: () => {
      pending = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    releaseSaving: () => release?.(),
    dispose: () => disk.rm(root, { recursive: true, force: true }),
  };
}

function addUrl() {
  const trigger =
    screen.queryByRole("button", { name: "Add link" }) ??
    screen.getByRole("button", { name: "URL" });
  fireEvent.click(trigger);
  const input = screen.getByPlaceholderText("Enter a URL…");
  fireEvent.change(input, { target: { value: NEW_URL } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.click(screen.getByRole("button", { name: "Add 1" }));
}

describe("AgentContextSectionPersistence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setInterfaceLocale("en");
    (ProjectFileManager as unknown as { instance: unknown }).instance = undefined;
  });
  afterEach(() => {
    act(() => mockOpenedModals.splice(0).forEach((modal) => modal.close()));
    cleanup();
    updateCachedProjectRecords([]);
  });

  describe("AgentContextSection()", () => {
    it("keeps edited context after save failure and retries without replacing newer project changes", async () => {
      const f = await fixture();
      try {
        fireEvent.click(screen.getByRole("button", { name: "Manage" }));
        await screen.findByRole("button", { name: "Save" });
        addUrl();
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        expect(mockOpenedModals[0].close).not.toHaveBeenCalled();
        await waitFor(() => expect(Notice).toHaveBeenCalledWith(FAILURE));
        expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(
          false
        );
        expect(await f.read()).toBe(f.original);
        expect(getCachedProjectRecordById(f.project.id)?.project).toMatchObject(f.project);
        await f.write(
          serializeProjectConfig(
            {
              ...f.project,
              description: "Updated outside the editor",
              systemPrompt: "Updated instructions\n",
            },
            await f.read()
          )
        );
        const latest = getCachedProjectRecordById(f.project.id)!;
        act(() =>
          upsertCachedProjectRecord({
            ...latest,
            project: {
              ...latest.project,
              description: "Updated outside the editor",
              systemPrompt: "Updated instructions\n",
            },
          })
        );
        f.allowSaving();
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(mockOpenedModals[0].close).toHaveBeenCalledTimes(1));
        expect(getCachedProjectRecordById(f.project.id)?.project.contextSource.webUrls).toContain(
          NEW_URL
        );
        expect(
          (
            parseYaml((await f.read()).match(/^---\n([\s\S]*?)\n---/)![1]) as Record<
              string,
              unknown
            >
          ).future
        ).toEqual({ nested: [1, { keep: true }] });
        expect(await f.read()).toContain("Updated instructions\n");
        expect(getCachedProjectRecordById(f.project.id)?.project.description).toBe(
          "Updated outside the editor"
        );
      } finally {
        await f.dispose();
      }
    });

    it("shows a pending save and prevents another save while the actual write is unfinished", async () => {
      const f = await fixture();
      try {
        f.allowSaving();
        f.holdSaving();
        fireEvent.click(screen.getByRole("button", { name: "Manage" }));
        await screen.findByRole("button", { name: "Save" });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        expect(screen.getByRole<HTMLButtonElement>("button", { name: "Saving..." }).disabled).toBe(
          true
        );
        expect(mockOpenedModals[0].close).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Saving..." }));
        await waitFor(() => expect(f.writeAdapter).toHaveBeenCalledTimes(1));
        expect(screen.getByRole<HTMLButtonElement>("button", { name: "Cancel" }).disabled).toBe(
          true
        );
        f.releaseSaving();
        await waitFor(() => expect(mockOpenedModals[0].close).toHaveBeenCalledTimes(1));
      } finally {
        f.releaseSaving();
        await f.dispose();
      }
    });

    it("reports an immediate context edit that failed to save and retains the original file and cached configuration", async () => {
      const f = await fixture();
      try {
        addUrl();
        await waitFor(() => expect(Notice).toHaveBeenCalledWith(FAILURE));
        expect(await f.read()).toBe(f.original);
        expect(getCachedProjectRecordById(f.project.id)?.project).toMatchObject(f.project);
      } finally {
        await f.dispose();
      }
    });
  });
});
