"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const failures = [];

const loadCriticalFiles = [
  "src/main.ts",
  "src/commands/index.ts",
  "src/settings/SettingsPage.tsx",
  "src/settings/v2/SettingsMainV2.tsx",
  "src/settings/v2/components/AdvancedSettings.tsx",
  "src/settings/v2/components/BasicSettings.tsx",
  "src/settings/v2/components/QuickToolsPanel.tsx",
  "src/settings/v2/components/ChatModelEnableList.tsx",
  "src/settings/v2/components/configuredModelGrouping.ts",
  "src/components/chat-components/plugins/SlashCommandPlugin.tsx",
  "src/components/chat-components/plugins/slashMenuItems.ts",
];

const nodeModuleIds = new Set([
  "async_hooks",
  "buffer",
  "child_process",
  "crypto",
  "electron",
  "events",
  "fs",
  "fs/promises",
  "module",
  "os",
  "path",
  "process",
  "readline",
  "stream",
  "url",
  "util",
  "node:async_hooks",
  "node:buffer",
  "node:child_process",
  "node:crypto",
  "node:events",
  "node:fs",
  "node:fs/promises",
  "node:module",
  "node:os",
  "node:path",
  "node:process",
  "node:readline",
  "node:stream",
  "node:url",
  "node:util",
]);

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function fail(message) {
  failures.push(message);
}

function formatError(error) {
  if (!(error instanceof Error)) return String(error);

  const stackLines = (error.stack ?? "")
    .split("\n")
    .filter((line) => !line.includes("main.js:1:"))
    .slice(0, 6);

  return [`${error.name}: ${error.message}`, ...stackLines.slice(1)].join("\n");
}

function isTypeOnlyImport(importStatement) {
  if (/^import\s+type\b/.test(importStatement.trim())) return true;
  const named = importStatement.match(/import\s*\{([^}]*)\}\s*from/);
  if (!named) return false;
  const specifiers = named[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return specifiers.length > 0 && specifiers.every((part) => part.startsWith("type "));
}

function checkAgentModeImportBoundaries() {
  const staticAgentModeImport =
    /import\s+(?:type\s+)?[^;]+?\s+from\s+["']@\/agentMode(?:\/[^"']*)?["']\s*;?/g;
  const dynamicAgentModeImport = /import\s*\(\s*["']@\/agentMode(?:\/[^"']*)?["']\s*\)/g;

  for (const relativePath of loadCriticalFiles) {
    const source = readRepoFile(relativePath);

    for (const match of source.matchAll(staticAgentModeImport)) {
      const statement = match[0];
      if (!isTypeOnlyImport(statement)) {
        fail(`${relativePath}: value import from Agent Mode is on the mobile load path.`);
      }
    }

    const dynamicImports = Array.from(source.matchAll(dynamicAgentModeImport));
    if (dynamicImports.length > 0 && !source.includes("isDesktopRuntime")) {
      fail(
        `${relativePath}: dynamic Agent Mode import must be gated by isDesktopRuntime() ` +
          `— Platform.isDesktopApp is true under app.emulateMobile(true).`
      );
    }
  }
}

function createCallableStub(name) {
  function Stub() {}
  Object.defineProperty(Stub, "name", { value: name.replace(/[^A-Za-z0-9_$]/g, "_") || "Stub" });
  return new Proxy(Stub, {
    apply() {
      return undefined;
    },
    construct() {
      return {};
    },
    get(target, prop) {
      if (prop === "prototype") return target.prototype;
      if (prop === Symbol.toStringTag) return name;
      return createCallableStub(`${name}.${String(prop)}`);
    },
  });
}

function createPoisonModule(id) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === Symbol.toStringTag) return id;
        throw new Error(
          `mobile-load-smoke: desktop-only module '${id}' was accessed at '${String(prop)}'.`
        );
      },
    }
  );
}

function isObsidianBrowserExternal(id) {
  return id.startsWith("@codemirror/") || id.startsWith("@lezer/");
}

function createObsidianStub(requestUrl = async () => ({ json: {}, text: "", status: 200 })) {
  class Component {
    registerEvent() {}
    registerDomEvent() {}
    registerInterval() {}
    load() {}
    unload() {}
  }

  class Plugin extends Component {
    constructor(app, manifest) {
      super();
      this.app = app;
      this.manifest = manifest ?? { id: "scribe", version: "mobile-load-smoke" };
    }

    addCommand() {}
    addRibbonIcon() {
      return { addClass() {}, removeClass() {}, setAttribute() {} };
    }
    addSettingTab() {}
    loadData() {
      return Promise.resolve(null);
    }
    saveData() {
      return Promise.resolve();
    }
    registerView() {}
    registerEditorExtension() {}
  }

  class PluginSettingTab {
    constructor(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      this.containerEl = { empty() {}, addClass() {}, createDiv: () => ({}) };
    }
  }

  class ItemView extends Component {
    constructor(leaf) {
      super();
      this.leaf = leaf;
      this.containerEl = {};
      this.contentEl = {};
    }
  }

  class Modal extends Component {
    constructor(app) {
      super();
      this.app = app;
    }
    open() {}
    close() {}
  }

  class Notice {
    constructor() {}
  }

  class TFile {}
  class TFolder {}
  class FileSystemAdapter {}
  class MarkdownView {}

  const obsidian = {
    App: class App {},
    Component,
    FileSystemAdapter,
    ItemView,
    MarkdownView,
    Modal,
    Notice,
    Platform: Object.freeze({
      isDesktop: false,
      isDesktopApp: false,
      isMobile: true,
      isMobileApp: true,
      isMacOS: false,
      isPhone: true,
      isTablet: false,
      isWin: false,
    }),
    Plugin,
    PluginSettingTab,
    TFile,
    TFolder,
    WorkspaceLeaf: class WorkspaceLeaf {},
    MarkdownRenderer: { render: async () => {} },
    addIcon() {},
    debounce(fn) {
      return fn;
    },
    moment: () => ({ format: () => "" }),
    normalizePath(value) {
      return String(value).replace(/\\/g, "/");
    },
    parseYaml() {
      return {};
    },
    requestUrl,
    stringifyYaml() {
      return "";
    },
  };

  return new Proxy(obsidian, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return createCallableStub(`obsidian.${String(prop)}`);
    },
  });
}

class SmokeEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}

class SmokeCustomEvent extends SmokeEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.detail = init.detail;
  }
}

class SmokeEventTarget {
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
}

function createMobileContext(requestUrl, fetch) {
  const module = { exports: {} };
  const context = {
    AbortController,
    AbortSignal,
    DOMException,
    atob,
    btoa,
    clearInterval,
    clearTimeout,
    console,
    crypto: require("node:crypto").webcrypto,
    CustomEvent: SmokeCustomEvent,
    Event: SmokeEvent,
    EventTarget: SmokeEventTarget,
    fetch:
      fetch ??
      (async () => ({ ok: true, json: async () => ({}), text: async () => "", body: null })),
    Blob,
    module,
    exports: module.exports,
    FormData,
    Headers,
    navigator: { userAgent: "ObsidianMobileSmoke/1.0" },
    performance,
    Promise,
    queueMicrotask,
    ReadableStream,
    Request,
    Response,
    require(id) {
      if (id === "obsidian") return createObsidianStub(requestUrl);
      if (isObsidianBrowserExternal(id)) return createCallableStub(id);
      if (nodeModuleIds.has(id)) return createPoisonModule(id);
      throw new Error(`mobile-load-smoke: unexpected external require '${id}'.`);
    },
    setInterval,
    setTimeout,
    TextDecoder,
    TextEncoder,
    TransformStream,
    URL,
    URLSearchParams,
    WritableStream,
  };
  context.globalThis = context;
  context.self = context;
  context.window = context;
  return context;
}

function runBundleEvaluationSmoke() {
  const bundlePath = path.join(repoRoot, "main.js");
  if (!fs.existsSync(bundlePath)) {
    fail("main.js is missing. Run npm run build before the mobile-load smoke test.");
    return;
  }
  const source = fs.readFileSync(bundlePath, "utf8");
  const context = createMobileContext();

  try {
    vm.runInNewContext(source, context, {
      filename: "main.js",
      timeout: 5000,
    });
  } catch (error) {
    fail(`main.js failed mobile bundle evaluation: ${formatError(error)}`);
    return;
  }

  const pluginExport = context.module.exports.default ?? context.module.exports;
  if (typeof pluginExport !== "function") {
    fail("main.js did not export the plugin class.");
  }
}

async function runByokFirstUseSmoke() {
  const { default: nodeModuleShim, nodeBuiltinExternals } = await import("../nodeModuleShim.mjs");
  const { default: svgrPlugin } = await import("../svgrPlugin.mjs");
  const build = await require("esbuild").build({
    stdin: {
      contents:
        'export { createProviderChatModel } from "./src/LLMProviders/createProviderChatModel"; export { fixtureSse } from "./src/LLMProviders/testing/piFixtures";',
      resolveDir: repoRoot,
      sourcefile: "mobile-byok-smoke.ts",
      loader: "ts",
    },
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: "es2020",
    write: false,
    external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...nodeBuiltinExternals],
    plugins: [nodeModuleShim, svgrPlugin],
    define: {
      global: "window",
      "process.env.NODE_ENV": '"production"',
      "import.meta.url": '"file:///mobile-byok-smoke.js"',
    },
  });
  const anthropic = {
    id: "fixture",
    type: "message",
    role: "assistant",
    model: "fixture",
    content: [{ type: "text", text: "OK" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  const google = { candidates: [{ content: { parts: [{ text: "OK" }] }, finishReason: "STOP" }] };
  const crypto = require("node:crypto").webcrypto;
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  const privateKey = Buffer.from(await crypto.subtle.exportKey("pkcs8", keys.privateKey)).toString(
    "base64"
  );
  const serviceAccount = JSON.stringify({
    client_email: "fixture@example.invalid",
    private_key: `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`,
  });
  const fixtures = [
    {
      npm: "@ai-sdk/openai-compatible",
      payload: { choices: [{ index: 0, message: { content: "OK" }, finish_reason: "stop" }] },
    },
    {
      npm: "@ai-sdk/openai",
      payload: {
        id: "r",
        object: "response",
        status: "completed",
        output: [
          {
            id: "m",
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "OK", annotations: [] }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    },
    { npm: "@ai-sdk/anthropic", payload: anthropic },
    { npm: "@ai-sdk/google", payload: google },
    {
      npm: "@ai-sdk/cohere",
      payload: { finish_reason: "COMPLETE", message: { content: [{ text: "OK" }] } },
    },
    { npm: "gitlab-ai-provider", name: "duo-chat-sonnet-4-6", payload: anthropic },
    {
      npm: "@ai-sdk/google-vertex",
      payload: google,
      providerOptions: { GOOGLE_VERTEX_PROJECT: "fixture-project" },
    },
    {
      npm: "@ai-sdk/google-vertex",
      payload: google,
      apiKey: serviceAccount,
      providerOptions: { GOOGLE_VERTEX_PROJECT: "fixture-project" },
    },
    {
      npm: "@ai-sdk/google-vertex/anthropic",
      payload: anthropic,
      providerOptions: { GOOGLE_VERTEX_PROJECT: "fixture-project" },
    },
    {
      npm: "@jerome-benoit/sap-ai-provider-v2",
      apiKey: JSON.stringify({
        clientid: "fixture",
        clientsecret: "fixture",
        url: "https://auth.fixture.invalid",
        serviceurls: { AI_API_URL: "https://sap.fixture.invalid" },
      }),
      providerOptions: { AICORE_DEPLOYMENT_ID: "fixture-deployment" },
      raw: 'data: {"final_result":{"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}}\n\ndata: [DONE]\n\n',
    },
    {
      npm: "scribe-ollama",
      raw: '{"message":{"content":"OK"},"done":true,"done_reason":"stop"}\n',
    },
  ];
  for (const enableCors of [false, true]) {
    for (const fixture of fixtures) {
      let nativeCalls = 0;
      let compatibleCalls = 0;
      let api;
      const respond = (url) => {
        const address = String(url);
        if (address.endsWith("/direct_access"))
          return new Response(JSON.stringify({ token: "fixture-token", headers: {} }));
        if (address.endsWith("/oauth/token") || address === "https://oauth2.googleapis.com/token")
          return new Response(JSON.stringify({ access_token: "fixture-token", expires_in: 3600 }));
        return new Response(fixture.raw ?? api.fixtureSse(fixture.payload), {
          headers: { "content-type": "text/event-stream" },
        });
      };
      const context = createMobileContext(
        async (request) => {
          compatibleCalls++;
          const response = respond(request.url);
          const text = await response.text();
          return {
            status: 200,
            text,
            json: text.startsWith("{") ? JSON.parse(text) : {},
            headers: Object.fromEntries(response.headers),
            arrayBuffer: new TextEncoder().encode(text).buffer,
          };
        },
        async (url) => {
          nativeCalls++;
          return respond(url);
        }
      );
      vm.runInNewContext(build.outputFiles[0].text, context, {
        filename: "mobile-byok-smoke.js",
        timeout: 5000,
      });
      api = context.module.exports;
      const model = await api.createProviderChatModel({
        name: fixture.name ?? "private-model",
        provider: "3rd party (openai-format)",
        providerNpm: fixture.npm,
        baseUrl: "https://fixture.invalid",
        enabled: true,
        enableCors,
        apiKey: fixture.apiKey ?? "fixture-key",
        providerOptions: fixture.providerOptions,
      });
      if (nativeCalls || compatibleCalls)
        throw new Error(`${fixture.npm}: construction sent a request`);
      let text = "";
      let done = false;
      for await (const event of model.stream(
        {
          messages: [{ role: "user", content: "Reply with OK.", timestamp: 0 }],
        },
        { maxRetries: 0 }
      )) {
        if (event.type === "text_delta") text += event.delta;
        if (event.type === "done") done = true;
      }
      if (text !== "OK" || !done) throw new Error(`${fixture.npm}: first request did not complete`);
      if (enableCors ? !compatibleCalls || nativeCalls : !nativeCalls || compatibleCalls)
        throw new Error(`${fixture.npm}: first request used the wrong transport`);
    }
  }
}

async function main() {
  checkAgentModeImportBoundaries();
  runBundleEvaluationSmoke();
  try {
    await runByokFirstUseSmoke();
  } catch (error) {
    fail(`BYOK first-use mobile smoke failed: ${formatError(error)}`);
  }
  if (failures.length > 0) {
    console.error("Mobile load smoke test failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("Mobile load and BYOK first-use smoke tests passed (10 protocols, both transports).");
}

void main();
