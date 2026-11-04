import type { AgentExtensionGroup, AgentExtensionRuntimeSnapshot } from "./extensionInventory";
import {
  extensionCheckCacheIdentity,
  extensionCheckCacheKey,
  readCachedExtensionCheck,
  readCachedExtensionView,
  resetExtensionCheckCacheForTests,
  storeCachedExtensionCheck,
  storeCachedExtensionView,
} from "./extensionCheckCache";
import type { App } from "obsidian";

const groups: readonly AgentExtensionGroup[] = [
  {
    kind: "mcp",
    status: "partial",
    warnings: [],
    items: [{ id: "notes", name: "notes", source: "user" }],
  },
];

function runtimeWith(status: string): AgentExtensionRuntimeSnapshot {
  return {
    commands: [],
    skills: null,
    plugins: null,
    failedPlugins: null,
    mcpServers: [{ name: "notes", status: status as "connected" }],
  };
}

function fakeApp(): { app: App; storage: Map<string, unknown> } {
  const storage = new Map<string, unknown>();
  const app = {
    loadLocalStorage: (key: string) => storage.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => {
      storage.set(key, value);
    },
  } as unknown as App;
  return { app, storage };
}

describe("extensionCheckCache", () => {
  beforeEach(() => resetExtensionCheckCacheForTests());

  describe("extensionCheckCacheKey", () => {
    it("separates backends, scopes, and configuration content", () => {
      const base = extensionCheckCacheKey(
        { backendId: "claude", scopeKind: "user", cwd: null },
        groups
      );
      expect(
        extensionCheckCacheKey({ backendId: "opencode", scopeKind: "user", cwd: null }, groups)
      ).not.toBe(base);
      expect(
        extensionCheckCacheKey({ backendId: "claude", scopeKind: "project", cwd: "/vault" }, groups)
      ).not.toBe(base);
      const changed: readonly AgentExtensionGroup[] = [
        {
          kind: "mcp",
          status: "partial",
          warnings: [],
          items: [
            { id: "notes", name: "notes", source: "user" },
            { id: "extra", name: "extra", source: "user" },
          ],
        },
      ];
      expect(
        extensionCheckCacheKey({ backendId: "claude", scopeKind: "user", cwd: null }, changed)
      ).not.toBe(base);
    });
  });

  describe("extensionCheckCacheIdentity", () => {
    it(`separates the backend, scope, working directory, and vault a saved answer belongs to`, () => {
      const identity = extensionCheckCacheIdentity({
        backendId: "claude",
        scopeKind: "user",
        cwd: null,
        vaultBase: "/vault",
      });
      expect(
        extensionCheckCacheIdentity({
          backendId: "claude",
          scopeKind: "user",
          cwd: null,
          vaultBase: "/vault",
        })
      ).toBe(identity);
      expect(
        extensionCheckCacheIdentity({
          backendId: "claude",
          scopeKind: "project",
          cwd: "/vault",
          vaultBase: "/vault",
        })
      ).not.toBe(identity);
      expect(
        extensionCheckCacheIdentity({
          backendId: "claude",
          scopeKind: "user",
          cwd: null,
          vaultBase: "/other",
        })
      ).not.toBe(identity);
    });
  });

  describe("storeCachedExtensionCheck", () => {
    it("stores a settled snapshot and answers it under the same key", () => {
      const key = extensionCheckCacheKey(
        { backendId: "claude", scopeKind: "user", cwd: null },
        groups
      );
      const runtime = runtimeWith("connected");
      storeCachedExtensionCheck(null, key, runtime);
      expect(readCachedExtensionCheck(null, key)).toBe(runtime);
      expect(readCachedExtensionCheck(null, "missing")).toBeNull();
    });
    it("never caches an in-flight snapshot that still shows a connecting server", () => {
      const key = extensionCheckCacheKey(
        { backendId: "claude", scopeKind: "user", cwd: null },
        groups
      );
      storeCachedExtensionCheck(null, key, runtimeWith("pending"));
      expect(readCachedExtensionCheck(null, key)).toBeNull();
    });
    it("evicts the oldest entry when the cache reaches its size cap", () => {
      const first = extensionCheckCacheKey(
        { backendId: "claude", scopeKind: "user", cwd: null },
        groups
      );
      for (let i = 0; i < 25; i++) {
        const varied: readonly AgentExtensionGroup[] = [
          {
            kind: "mcp",
            status: "partial",
            warnings: [],
            items: [{ id: `notes-${i}`, name: `notes-${i}`, source: "user" }],
          },
        ];
        storeCachedExtensionCheck(
          null,
          extensionCheckCacheKey({ backendId: "claude", scopeKind: "user", cwd: null }, varied),
          runtimeWith("connected")
        );
      }
      expect(readCachedExtensionCheck(null, first)).toBeNull();
    });
    it(`answers after a plugin reload from the snapshot saved in local storage`, () => {
      const { app } = fakeApp();
      const key = extensionCheckCacheKey(
        { backendId: "claude", scopeKind: "user", cwd: null },
        groups
      );
      storeCachedExtensionCheck(app, key, runtimeWith("connected"));

      resetExtensionCheckCacheForTests();

      expect(readCachedExtensionCheck(app, key)?.mcpServers).toEqual([
        { name: "notes", status: "connected" },
      ]);
    });
  });

  describe("readCachedExtensionView", () => {
    it("answers nothing when no page has saved an answer for the scope yet", () => {
      expect(readCachedExtensionView(null, "claude")).toBeNull();
    });
    it(`restores the saved answer after a plugin reload`, () => {
      const { app } = fakeApp();
      const view = { groups, runtimeState: "checked" as const };
      storeCachedExtensionView(app, "claude", view);

      resetExtensionCheckCacheForTests();

      expect(readCachedExtensionView(app, "claude")).toEqual(view);
    });
    it("ignores a saved payload that does not carry a group list", () => {
      const { app, storage } = fakeApp();
      storage.set("scribe:extension-check-cache:v1", { checks: {}, views: { claude: "broken" } });
      expect(readCachedExtensionView(app, "claude")).toBeNull();
    });
  });

  describe("storeCachedExtensionView", () => {
    it(`keeps the most recent answer for each backend and scope`, () => {
      const { app } = fakeApp();
      storeCachedExtensionView(app, "claude", { groups, runtimeState: "checked" });
      const changed = { groups, runtimeState: "partial" as const };
      storeCachedExtensionView(app, "claude", changed);
      expect(readCachedExtensionView(app, "claude")).toEqual(changed);
    });
    it("evicts the oldest saved answer once the view cache reaches its size cap", () => {
      for (let i = 0; i < 10; i++) {
        storeCachedExtensionView(null, `scope-${i}`, { groups, runtimeState: "checked" });
      }
      expect(readCachedExtensionView(null, "scope-0")).toBeNull();
      expect(readCachedExtensionView(null, "scope-9")).not.toBeNull();
    });
  });
});
