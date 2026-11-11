import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { App, FileSystemAdapter, MarkdownRenderer } from "obsidian";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/utils/openWithSystemDefault", () => ({ openWithSystemDefault: jest.fn() }));
jest.mock("obsidian", () => ({
  Keymap: jest.requireActual<typeof import("obsidian")>("obsidian").Keymap,
  FileSystemAdapter: class FileSystemAdapter {
    private readonly base: string;
    constructor(base = "/vault") {
      this.base = base;
    }
    getBasePath(): string {
      return this.base;
    }
  },
  Notice: jest.fn(),
  MarkdownRenderer: { render: jest.fn().mockResolvedValue(undefined) },
}));

const VAULT = "/Users/me/vault";

interface TestApp {
  workspace: { openLinkText: jest.Mock; getActiveFile: () => null };
  vault: { adapter: unknown; getAbstractFileByPath: jest.Mock };
  metadataCache: { getFirstLinkpathDest: jest.Mock };
}

function buildApp(): TestApp {
  const adapter = new (FileSystemAdapter as unknown as new (b: string) => unknown)(VAULT);
  return {
    workspace: { openLinkText: jest.fn(), getActiveFile: () => null },
    vault: { adapter, getAbstractFileByPath: jest.fn(() => null) },
    metadataCache: { getFirstLinkpathDest: jest.fn(() => null) },
  };
}

async function clickInternalLink(
  app: TestApp,
  dataHref: string,
  init: MouseEventInit = { button: 0 }
): Promise<void> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const component = { register: jest.fn() } as unknown as Parameters<typeof renderMarkdown>[4];
  await renderMarkdown(app as unknown as App, "irrelevant", el, "source.md", component);
  const a = document.createElement("a");
  a.className = "internal-link";
  a.setAttribute("data-href", dataHref);
  el.appendChild(a);
  a.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
}

describe("renderMarkdown", () => {
  describe("renderMarkdown()", () => {
    beforeEach(() => {
      __resetVaultBaseCache();
      jest.clearAllMocks();
      document.body.innerHTML = "";
    });

    it("opens a clicked internal link with its absolute in-vault path converted to vault-relative", async () => {
      const app = buildApp();
      await clickInternalLink(app, "/Users/me/vault/00_Inbox/Foo.md");
      expect(app.workspace.openLinkText).toHaveBeenCalledWith(
        "00_Inbox/Foo.md",
        "source.md",
        "tab"
      );
      expect(openWithSystemDefault).not.toHaveBeenCalled();
    });

    it("decodes a percent-encoded link target before opening it", async () => {
      const app = buildApp();
      await clickInternalLink(app, "/Users/me/vault/00_Inbox/Foo%20Bar.md");
      expect(app.workspace.openLinkText).toHaveBeenCalledWith(
        "00_Inbox/Foo Bar.md",
        "source.md",
        "tab"
      );
    });

    it("opens the link in a new tab on ctrl-click", async () => {
      const app = buildApp();
      await clickInternalLink(app, "/Users/me/vault/00_Inbox/Foo.md", { button: 0, ctrlKey: true });
      expect(app.workspace.openLinkText).toHaveBeenCalledWith(
        "00_Inbox/Foo.md",
        "source.md",
        "tab"
      );
    });
    it("removes delegated links while host work is pending without wiring them again later https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
      let finish: (() => void) | undefined;
      jest
        .mocked(MarkdownRenderer as unknown as { render: jest.Mock })
        .render.mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            })
        );
      const cleanup: (() => void)[] = [];
      const component = {
        register: (callback: () => void) => cleanup.push(callback),
      } as unknown as Parameters<typeof renderMarkdown>[4];
      const el = document.createElement("div");
      const app = buildApp();
      const work = renderMarkdown(app as unknown as App, "[[Note]]", el, "source.md", component);
      expect(cleanup).toHaveLength(1);
      cleanup[0]();
      finish?.();
      await work;
      const link = el.createEl("a", { cls: "internal-link", attr: { "data-href": "Note" } });
      link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(app.workspace.openLinkText).not.toHaveBeenCalled();
    });
  });
});
