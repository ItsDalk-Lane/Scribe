import {
  mcpSecretId,
  deleteUnusedMcpSecretEntries,
  persistMcpSecretEntries,
  resolveMcpValues,
  type McpSecretStorePort,
} from "@/agentMode/mcp/secretRefs";

function createMemorySecretStore(): McpSecretStorePort & {
  values: Map<string, string>;
  deleted: string[];
} {
  const values = new Map<string, string>();
  const deleted: string[] = [];
  return {
    values,
    deleted,
    async setSecret(id, value) {
      values.set(id, value);
    },
    async deleteSecret(id) {
      values.delete(id);
      deleted.push(id);
    },
    async withSecret(id, execute) {
      const value = values.get(id);
      if (value === undefined) throw new Error(`missing secret: ${id}`);
      return execute(value);
    },
    getStatus(id) {
      return values.has(id) ? "available" : "missing";
    },
  };
}

describe("secretRefs", () => {
  describe("mcpSecretId()", () => {
    it("builds a stable per-server, per-scope, per-key identifier", () => {
      expect(mcpSecretId("srv-1", "headers", "Authorization")).toBe(
        "mcp:srv-1:headers:Authorization"
      );
    });
  });

  describe("persistMcpSecretEntries()", () => {
    it("moves sensitive keys into the store and records refs", async () => {
      const store = createMemorySecretStore();
      const result = await persistMcpSecretEntries(
        store,
        "srv-1",
        {
          env: { HOME: "/home", API_KEY: "sk-secret" },
          headers: { Authorization: "Bearer token", "X-Trace": "abc" },
        },
        []
      );
      expect(result.env).toEqual({ HOME: "/home" });
      expect(result.headers).toEqual({ "X-Trace": "abc" });
      expect(result.secretRefs).toEqual([
        { scope: "env", key: "API_KEY", secretId: "mcp:srv-1:env:API_KEY" },
        { scope: "headers", key: "Authorization", secretId: "mcp:srv-1:headers:Authorization" },
      ]);
      expect(store.values.get("mcp:srv-1:env:API_KEY")).toBe("sk-secret");
      expect(store.values.get("mcp:srv-1:headers:Authorization")).toBe("Bearer token");
    });

    it("keeps an existing ref when the sensitive field is left blank", async () => {
      const store = createMemorySecretStore();
      const previous = [
        {
          scope: "headers" as const,
          key: "Authorization",
          secretId: "mcp:srv-1:headers:Authorization",
        },
      ];
      const result = await persistMcpSecretEntries(
        store,
        "srv-1",
        { headers: { Authorization: "" } },
        previous
      );
      expect(result.secretRefs).toEqual(previous);
      expect(result.headers).toBeUndefined();
      expect(store.deleted).toEqual([]);
    });

    it("stages a replacement under a new reference while preserving the original credential", async () => {
      const store = createMemorySecretStore();
      const previous = [
        { scope: "env" as const, key: "API_KEY", secretId: "mcp:srv-1:env:API_KEY" },
      ];
      await store.setSecret("mcp:srv-1:env:API_KEY", "original");
      const result = await persistMcpSecretEntries(
        store,
        "srv-1",
        { env: { API_KEY: "rotated" } },
        previous
      );
      expect(result.secretRefs).toHaveLength(1);
      const replacementId = result.secretRefs![0].secretId;
      expect(replacementId).not.toBe("mcp:srv-1:env:API_KEY");
      expect(store.values.get(replacementId)).toBe("rotated");
      expect(store.values.get("mcp:srv-1:env:API_KEY")).toBe("original");
    });

    it("drops a removed key from the next references but retains its credential until configuration commits", async () => {
      const store = createMemorySecretStore();
      await store.setSecret("mcp:srv-1:env:API_KEY", "old");
      const previous = [
        { scope: "env" as const, key: "API_KEY", secretId: "mcp:srv-1:env:API_KEY" },
      ];
      const result = await persistMcpSecretEntries(store, "srv-1", { env: {} }, previous);
      expect(result.secretRefs).toBeUndefined();
      expect(store.deleted).toEqual([]);
      expect(store.values.get("mcp:srv-1:env:API_KEY")).toBe("old");
    });

    it("drops empty values for non-sensitive keys", async () => {
      const store = createMemorySecretStore();
      const result = await persistMcpSecretEntries(store, "srv-1", { env: { HOME: "" } }, []);
      expect(result.env).toBeUndefined();
      expect(result.secretRefs).toBeUndefined();
    });
  });

  describe("deleteUnusedMcpSecretEntries()", () => {
    it("removes only credentials no longer referenced by the committed configuration", async () => {
      const store = createMemorySecretStore();
      await store.setSecret("old", "original");
      await store.setSecret("current", "retained");
      const previous = [
        { scope: "headers" as const, key: "Authorization", secretId: "old" },
        { scope: "env" as const, key: "API_KEY", secretId: "current" },
      ];
      await deleteUnusedMcpSecretEntries(store, previous, [previous[1]]);
      expect(store.values.has("old")).toBe(false);
      expect(store.values.get("current")).toBe("retained");
      expect(store.deleted).toEqual(["old"]);
    });

    it("reports a cleanup failure without attempting to replace any credential", async () => {
      const store = createMemorySecretStore();
      store.deleteSecret = async () => {
        throw new Error("synthetic cleanup failure");
      };
      await expect(
        deleteUnusedMcpSecretEntries(store, [{ scope: "env", key: "API_KEY", secretId: "old" }], [])
      ).rejects.toThrow("synthetic cleanup failure");
      expect(store.values.size).toBe(0);
    });
  });

  describe("resolveMcpValues()", () => {
    it("merges inline entries with secrets resolved from the store", async () => {
      const store = createMemorySecretStore();
      await store.setSecret("mcp:srv-1:headers:Authorization", "Bearer token");
      const resolved = await resolveMcpValues(store, {
        headers: { "X-Trace": "abc" },
        secretRefs: [
          { scope: "headers", key: "Authorization", secretId: "mcp:srv-1:headers:Authorization" },
        ],
      });
      expect(resolved.headers).toEqual({ "X-Trace": "abc", Authorization: "Bearer token" });
      expect(resolved.env).toEqual({});
    });

    it("does not mutate the server record it reads", async () => {
      const store = createMemorySecretStore();
      await store.setSecret("mcp:srv-1:env:API_KEY", "sk-secret");
      const server = {
        env: { HOME: "/home" },
        secretRefs: [{ scope: "env" as const, key: "API_KEY", secretId: "mcp:srv-1:env:API_KEY" }],
      };
      await resolveMcpValues(store, server);
      expect(Object.keys(server.env)).toEqual(["HOME"]);
    });

    it("propagates the store error when a referenced secret is missing", async () => {
      const store = createMemorySecretStore();
      await expect(
        resolveMcpValues(store, {
          secretRefs: [{ scope: "env", key: "API_KEY", secretId: "mcp:srv-1:env:API_KEY" }],
        })
      ).rejects.toThrow(/missing secret/);
    });
  });
});
