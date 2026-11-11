import {
  createMcpServerConfig,
  effectiveTimeoutSeconds,
  exportMcpServersJson,
  formatArgLines,
  formatKeyValueLines,
  formatSecretAwareKeyValueLines,
  inferMcpServerType,
  isValidMcpUrl,
  mcpServerConnectionFingerprint,
  parseArgLines,
  parseKeyValueLines,
  parseMcpServersImportJson,
  sanitizeMcpSection,
  sanitizeMcpServer,
} from "@/agentMode/mcp/configSchema";

function stdioRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "srv-1",
    name: "files",
    type: "stdio",
    command: "npx",
    args: ["-y", "server-files"],
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("configSchema", () => {
  describe("sanitizeMcpServer()", () => {
    it("builds a stdio config from a valid record", () => {
      const server = sanitizeMcpServer(stdioRaw());
      expect(server).toMatchObject({
        id: "srv-1",
        name: "files",
        type: "stdio",
        command: "npx",
        args: ["-y", "server-files"],
        isActive: true,
      });
      expect(server?.createdAt).toBe("2026-01-01T00:00:00.000Z");
      expect(server?.updatedAt).toBe("2026-01-02T00:00:00.000Z");
    });

    it("returns null when id or name is missing", () => {
      expect(sanitizeMcpServer({ name: "files" })).toBeNull();
      expect(sanitizeMcpServer({ id: "srv-1" })).toBeNull();
      expect(sanitizeMcpServer(null)).toBeNull();
      expect(sanitizeMcpServer("files")).toBeNull();
    });

    it("keeps only stdio fields on stdio servers", () => {
      const server = sanitizeMcpServer(
        stdioRaw({ url: "http://localhost:3000/sse", headers: { Authorization: "Bearer x" } })
      );
      expect(server).not.toHaveProperty("url");
      expect(server).not.toHaveProperty("headers");
    });

    it("keeps only remote fields on remote servers", () => {
      const server = sanitizeMcpServer({
        id: "srv-2",
        name: "remote",
        type: "sse",
        url: "https://mcp.example.com/sse",
        headers: { "X-Key": "abc" },
        command: "npx",
        args: ["-y", "server-files"],
        env: { PATH: "/usr/bin" },
        isActive: false,
        createdAt: "",
        updatedAt: "",
      });
      expect(server).toMatchObject({
        url: "https://mcp.example.com/sse",
        headers: { "X-Key": "abc" },
      });
      expect(server).not.toHaveProperty("command");
      expect(server).not.toHaveProperty("args");
      expect(server).not.toHaveProperty("env");
    });

    it("drops remote servers whose URL is not http(s)", () => {
      expect(
        sanitizeMcpServer({ id: "srv-3", name: "bad", type: "sse", url: "ftp://example.com" })
      ).not.toHaveProperty("url");
      expect(
        sanitizeMcpServer({ id: "srv-3", name: "bad", type: "sse", url: "not a url" })
      ).not.toHaveProperty("url");
    });

    it("rejects non-positive and non-integer timeouts", () => {
      expect(sanitizeMcpServer(stdioRaw({ timeoutSeconds: 0 }))?.timeoutSeconds).toBeUndefined();
      expect(sanitizeMcpServer(stdioRaw({ timeoutSeconds: -5 }))?.timeoutSeconds).toBeUndefined();
      expect(sanitizeMcpServer(stdioRaw({ timeoutSeconds: 1.5 }))?.timeoutSeconds).toBeUndefined();
      expect(sanitizeMcpServer(stdioRaw({ timeoutSeconds: 120 }))?.timeoutSeconds).toBe(120);
    });

    it("defaults isActive to false", () => {
      expect(sanitizeMcpServer(stdioRaw({ isActive: undefined }))?.isActive).toBe(false);
    });

    it("keeps env and headers secret refs and drops malformed ones", () => {
      const server = sanitizeMcpServer(
        stdioRaw({
          secretRefs: [
            { scope: "env", key: "API_KEY", secretId: "mcp:srv-1:env:API_KEY" },
            {
              scope: "headers",
              key: "Authorization",
              secretId: "mcp:srv-1:headers:Authorization",
            },
            { scope: "nope", key: "X", secretId: "y" },
            { scope: "headers" },
            "junk",
          ],
        })
      );
      expect(server?.secretRefs).toEqual([
        { scope: "env", key: "API_KEY", secretId: "mcp:srv-1:env:API_KEY" },
        { scope: "headers", key: "Authorization", secretId: "mcp:srv-1:headers:Authorization" },
      ]);
    });
  });

  describe("sanitizeMcpSection()", () => {
    it("returns an empty section for missing or malformed input", () => {
      expect(sanitizeMcpSection(undefined)).toEqual({ servers: [] });
      expect(sanitizeMcpSection("mcp")).toEqual({ servers: [] });
      expect(sanitizeMcpSection({ servers: "all" })).toEqual({ servers: [] });
    });

    it("filters invalid servers and duplicate ids", () => {
      const section = sanitizeMcpSection({
        servers: [
          stdioRaw(),
          { id: "srv-1", name: "duplicate" },
          { name: "no-id" },
          stdioRaw({ id: "srv-2", name: "second" }),
        ],
      });
      expect(section.servers.map((server) => server.id)).toEqual(["srv-1", "srv-2"]);
    });
  });

  describe("createMcpServerConfig()", () => {
    it("creates an inactive server with generated identity and timestamps", () => {
      const server = createMcpServerConfig({ name: "files", type: "stdio", sortOrder: 3 });
      expect(server.name).toBe("files");
      expect(server.type).toBe("stdio");
      expect(server.isActive).toBe(false);
      expect(server.sortOrder).toBe(3);
      expect(server.id).toBeTruthy();
      expect(server.createdAt).toBe(server.updatedAt);
      expect(new Date(server.createdAt).getTime()).not.toBeNaN();
    });
  });

  describe("parseKeyValueLines()", () => {
    it("parses KEY=value lines, splitting at the first equals sign", () => {
      expect(parseKeyValueLines("A=1\nB=x=y\n")).toEqual({ A: "1", B: "x=y" });
    });

    it("ignores blank lines and lines without a key", () => {
      expect(parseKeyValueLines("\n  \n=odd\nC=3")).toEqual({ C: "3" });
    });

    it("trims whitespace around keys and values", () => {
      expect(parseKeyValueLines("  KEY =  value  ")).toEqual({ KEY: "value" });
    });

    it("returns an empty record for empty text", () => {
      expect(parseKeyValueLines("")).toEqual({});
    });
  });

  describe("formatKeyValueLines()", () => {
    it("joins entries as KEY=value lines", () => {
      expect(formatKeyValueLines({ A: "1", B: "2" })).toBe("A=1\nB=2");
    });

    it("returns empty text for missing records", () => {
      expect(formatKeyValueLines(undefined)).toBe("");
      expect(formatKeyValueLines({})).toBe("");
    });
  });

  describe("formatSecretAwareKeyValueLines()", () => {
    const refs = [
      { scope: "headers" as const, key: "Authorization", secretId: "mcp:s:headers:Authorization" },
      { scope: "env" as const, key: "API_KEY", secretId: "mcp:s:env:API_KEY" },
    ];

    it("shows stored secret keys as blank-value lines so they survive restarts visibly", () => {
      expect(formatSecretAwareKeyValueLines({ "X-Trace": "abc" }, refs, "headers")).toBe(
        "X-Trace=abc\nAuthorization="
      );
      expect(formatSecretAwareKeyValueLines(undefined, refs, "env")).toBe("API_KEY=");
    });

    it("does not duplicate keys that also exist inline", () => {
      expect(formatSecretAwareKeyValueLines({ Authorization: "inline" }, refs, "headers")).toBe(
        "Authorization=inline"
      );
    });

    it("ignores references from other scopes", () => {
      expect(formatSecretAwareKeyValueLines({}, refs, "headers")).not.toContain("API_KEY");
    });

    it("round-trips through parseKeyValueLines keeping the blank key present", () => {
      const text = formatSecretAwareKeyValueLines(undefined, refs, "headers");
      expect(parseKeyValueLines(text)).toEqual({ Authorization: "" });
    });
  });

  describe("parseArgLines()", () => {
    it("reads one argument per line and drops blanks", () => {
      expect(parseArgLines("-y\n\nserver-files\n--port 3000")).toEqual([
        "-y",
        "server-files",
        "--port 3000",
      ]);
      expect(parseArgLines("")).toEqual([]);
    });
  });

  describe("formatArgLines()", () => {
    it("writes one argument per line", () => {
      expect(formatArgLines(["-y", "server-files"])).toBe("-y\nserver-files");
      expect(formatArgLines(undefined)).toBe("");
    });
  });

  describe("inferMcpServerType()", () => {
    it("prefers stdio when a command is present", () => {
      expect(inferMcpServerType({ command: "uvx", url: "http://x/sse" })).toBe("stdio");
    });

    it("maps /mcp URLs to streamableHttp and other URLs to sse", () => {
      expect(inferMcpServerType({ url: "http://localhost:3000/mcp" })).toBe("streamableHttp");
      expect(inferMcpServerType({ url: "http://localhost:3000/mcp/" })).toBe("streamableHttp");
      expect(inferMcpServerType({ url: "http://localhost:3000/sse" })).toBe("sse");
    });

    it("falls back to stdio when nothing is recognizable", () => {
      expect(inferMcpServerType({})).toBe("stdio");
    });
  });

  describe("isValidMcpUrl()", () => {
    it("accepts http and https URLs only", () => {
      expect(isValidMcpUrl("http://localhost:3000/sse")).toBe(true);
      expect(isValidMcpUrl("https://mcp.example.com/mcp")).toBe(true);
      expect(isValidMcpUrl("ftp://example.com")).toBe(false);
      expect(isValidMcpUrl("localhost:3000")).toBe(false);
    });
  });

  describe("parseMcpServersImportJson()", () => {
    it("imports stdio servers from the shared mcpServers JSON format", () => {
      const result = parseMcpServersImportJson(
        JSON.stringify({
          mcpServers: {
            files: { command: "npx", args: ["-y", "server-files"], env: { HOME: "/home" } },
          },
        })
      );
      expect(result.issues).toEqual([]);
      expect(result.servers).toHaveLength(1);
      expect(result.servers[0]).toMatchObject({
        name: "files",
        type: "stdio",
        command: "npx",
        args: ["-y", "server-files"],
        env: { HOME: "/home" },
        isActive: false,
      });
    });

    it("imports remote servers, normalizing legacy types and inferring from the URL", () => {
      const result = parseMcpServersImportJson(
        JSON.stringify({
          mcpServers: {
            stream: { type: "http", url: "https://mcp.example.com/mcp" },
            events: { url: "https://mcp.example.com/sse", headers: { "X-Key": "abc" } },
          },
        })
      );
      expect(result.servers.map((server) => server.type)).toEqual(["streamableHttp", "sse"]);
    });

    it("honors an explicit http transport regardless of the endpoint suffix", () => {
      const result = parseMcpServersImportJson(
        JSON.stringify({
          mcpServers: { remote: { type: "http", url: "https://example.com/tools" } },
        })
      );
      expect(result.servers[0].type).toBe("streamableHttp");
    });

    it("reports issues for duplicate names, missing commands, and invalid URLs", () => {
      const result = parseMcpServersImportJson(
        JSON.stringify({
          mcpServers: {
            files: { command: "npx" },
            alias: { name: "files", command: "uvx" },
            empty: { args: ["x"] },
            bad: { url: "ftp://example.com" },
          },
        })
      );
      expect(result.servers.map((server) => server.name)).toEqual(["files"]);
      expect(result.issues).toEqual([
        { serverName: "files", reason: "duplicate-name" },
        { serverName: "empty", reason: "missing-endpoint" },
        { serverName: "bad", reason: "invalid-url" },
      ]);
    });

    it("throws on invalid JSON text", () => {
      expect(() => parseMcpServersImportJson("{ not json")).toThrow("Invalid JSON.");
    });

    it("throws when the root is not a server mapping", () => {
      expect(() => parseMcpServersImportJson(JSON.stringify([1, 2]))).toThrow(/mcpServers/);
    });
  });

  describe("exportMcpServersJson()", () => {
    it("exports servers in the shared mcpServers JSON format", () => {
      const servers = [
        sanitizeMcpServer(
          stdioRaw({ description: "File access", timeoutSeconds: 120, longRunning: true })
        )!,
        sanitizeMcpServer({
          id: "srv-2",
          name: "remote",
          type: "streamableHttp",
          url: "https://mcp.example.com/mcp",
          headers: { "X-Key": "abc" },
          tags: ["search"],
          isActive: true,
          createdAt: "",
          updatedAt: "",
        })!,
      ];
      const exported = JSON.parse(exportMcpServersJson(servers)) as {
        mcpServers: Record<string, Record<string, unknown>>;
      };
      expect(exported.mcpServers.files).toEqual({
        type: "stdio",
        description: "File access",
        command: "npx",
        args: ["-y", "server-files"],
        timeout: 120,
        longRunning: true,
      });
      expect(exported.mcpServers.remote).toEqual({
        type: "streamableHttp",
        url: "https://mcp.example.com/mcp",
        headers: { "X-Key": "abc" },
        tags: ["search"],
      });
    });
  });

  describe("effectiveTimeoutSeconds()", () => {
    it("defaults to 60 seconds when unset", () => {
      const server = sanitizeMcpServer(stdioRaw())!;
      expect(effectiveTimeoutSeconds(server)).toBe(60);
    });

    it("uses the configured timeout when set", () => {
      const server = sanitizeMcpServer(stdioRaw({ timeoutSeconds: 30 }))!;
      expect(effectiveTimeoutSeconds(server)).toBe(30);
      expect(effectiveTimeoutSeconds(sanitizeMcpServer(stdioRaw({ timeoutSeconds: 1200 }))!)).toBe(
        1200
      );
    });

    it.each([
      { configured: 30, expected: 30 },
      { configured: undefined, expected: 60 },
      { configured: 1200, expected: 600 },
    ])(
      "uses $expected seconds between progress updates for long-running servers configured with $configured",
      ({ configured, expected }) => {
        const server = sanitizeMcpServer(
          stdioRaw({ timeoutSeconds: configured, longRunning: true })
        )!;
        expect(effectiveTimeoutSeconds(server)).toBe(expected);
      }
    );
  });

  describe("mcpServerConnectionFingerprint()", () => {
    it("ignores display-only fields", () => {
      const before = mcpServerConnectionFingerprint(sanitizeMcpServer(stdioRaw())!);
      const after = mcpServerConnectionFingerprint(
        sanitizeMcpServer(stdioRaw({ name: "renamed", description: "new", tags: ["x"] }))!
      );
      expect(after).toBe(before);
    });

    it("changes when connection-relevant fields change", () => {
      const base = sanitizeMcpServer(stdioRaw({ isActive: false }))!;
      expect(mcpServerConnectionFingerprint({ ...base, isActive: true })).not.toBe(
        mcpServerConnectionFingerprint(base)
      );
      expect(mcpServerConnectionFingerprint({ ...base, args: ["changed"] })).not.toBe(
        mcpServerConnectionFingerprint(base)
      );
      expect(mcpServerConnectionFingerprint({ ...base, autoApprovedTools: ["t"] })).not.toBe(
        mcpServerConnectionFingerprint(base)
      );
    });
  });
});
