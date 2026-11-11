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
        { backendId: "test-backend-a", scopeKind: "user", cwd: null },
        groups
      );
      expect(
        extensionCheckCacheKey(
          { backendId: "test-backend-b", scopeKind: "user", cwd: null },
          groups
        )
      ).not.toBe(base);
      expect(
        extensionCheckCacheKey(
          { backendId: "test-backend-a", scopeKind: "project", cwd: "/vault" },
          groups
        )
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
        extensionCheckCacheKey(
          { backendId: "test-backend-a", scopeKind: "user", cwd: null },
          changed
        )
      ).not.toBe(base);
    });
  });

  describe("extensionCheckCacheIdentity", () => {
    it(`separates the backend, scope, working directory, and vault a saved answer belongs to`, () => {
      const identity = extensionCheckCacheIdentity({
        backendId: "test-backend-a",
        scopeKind: "user",
        cwd: null,
        vaultBase: "/vault",
      });
      expect(
        extensionCheckCacheIdentity({
          backendId: "test-backend-a",
          scopeKind: "user",
          cwd: null,
          vaultBase: "/vault",
        })
      ).toBe(identity);
      expect(
        extensionCheckCacheIdentity({
          backendId: "test-backend-a",
          scopeKind: "project",
          cwd: "/vault",
          vaultBase: "/vault",
        })
      ).not.toBe(identity);
      expect(
        extensionCheckCacheIdentity({
          backendId: "test-backend-a",
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
        { backendId: "test-backend-a", scopeKind: "user", cwd: null },
        groups
      );
      const runtime = runtimeWith("connected");
      storeCachedExtensionCheck(null, key, runtime);
      expect(readCachedExtensionCheck(null, key)).toBe(runtime);
      expect(readCachedExtensionCheck(null, "missing")).toBeNull();
    });
    it("never caches an in-flight snapshot that still shows a connecting server", () => {
      const key = extensionCheckCacheKey(
        { backendId: "test-backend-a", scopeKind: "user", cwd: null },
        groups
      );
      storeCachedExtensionCheck(null, key, runtimeWith("pending"));
      expect(readCachedExtensionCheck(null, key)).toBeNull();
    });
    it("evicts the oldest entry when the cache reaches its size cap", () => {
      const first = extensionCheckCacheKey(
        { backendId: "test-backend-a", scopeKind: "user", cwd: null },
        groups
      );
      storeCachedExtensionCheck(null, first, runtimeWith("connected"));
      expect(readCachedExtensionCheck(null, first)).not.toBeNull();
      for (let i = 0; i < 19; i++) {
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
          extensionCheckCacheKey(
            { backendId: "test-backend-a", scopeKind: "user", cwd: null },
            varied
          ),
          runtimeWith("connected")
        );
      }
      expect(readCachedExtensionCheck(null, first)).not.toBeNull();
      const newest = extensionCheckCacheKey(
        { backendId: "test-backend-a", scopeKind: "project", cwd: "/vault" },
        groups
      );
      storeCachedExtensionCheck(null, newest, runtimeWith("connected"));
      expect(readCachedExtensionCheck(null, first)).toBeNull();
      expect(readCachedExtensionCheck(null, newest)).not.toBeNull();
    });
    it(`discards snapshots on reload without saving them to local storage`, () => {
      const { app } = fakeApp();
      const key = extensionCheckCacheKey(
        { backendId: "test-backend-a", scopeKind: "user", cwd: null },
        groups
      );
      storeCachedExtensionCheck(app, key, runtimeWith("connected"));

      resetExtensionCheckCacheForTests();

      expect(readCachedExtensionCheck(app, key)).toBeNull();
    });
  });

  describe("readCachedExtensionView", () => {
    it("answers nothing when no page has saved an answer for the scope yet", () => {
      expect(readCachedExtensionView(null, "test-backend-a")).toBeNull();
    });
    it(`does not restore old answers after a plugin reload`, () => {
      const { app } = fakeApp();
      const view = { groups, runtimeState: "checked" as const };
      storeCachedExtensionView(app, "test-backend-a", view);

      resetExtensionCheckCacheForTests();

      expect(readCachedExtensionView(app, "test-backend-a")).toBeNull();
    });
    it("ignores a saved payload that does not carry a group list", () => {
      const { app, storage } = fakeApp();
      storage.set("scribe:extension-check-cache:v1", {
        checks: {},
        views: { "test-backend-a": "broken" },
      });
      expect(readCachedExtensionView(app, "test-backend-a")).toBeNull();
    });
  });

  describe("storeCachedExtensionView", () => {
    it(`keeps the most recent answer for each backend and scope`, () => {
      const { app } = fakeApp();
      storeCachedExtensionView(app, "test-backend-a", { groups, runtimeState: "checked" });
      const changed = { groups, runtimeState: "partial" as const };
      storeCachedExtensionView(app, "test-backend-a", changed);
      expect(readCachedExtensionView(app, "test-backend-a")).toEqual(changed);
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
