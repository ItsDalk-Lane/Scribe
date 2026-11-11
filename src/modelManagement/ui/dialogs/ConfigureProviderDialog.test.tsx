import type { VerificationResult } from "@/modelManagement/types/runtime";
import type { TestProviderConnectionInput } from "@/LLMProviders/testProviderConnection";
import type { SetupProviderInput } from "@/modelManagement/setup/ByokSetupApi";
import { resolveProviderConnection } from "@/modelManagement/chatModel/resolveProviderConnection";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { Platform } from "obsidian";

const mockVerifyCredentials = jest.fn<Promise<VerificationResult>, [string, unknown]>();
const mockSetupProvider = jest
  .fn<Promise<{ providerId: string; configuredModelIds: string[] }>, [unknown]>()
  .mockResolvedValue({ providerId: "p-new", configuredModelIds: ["cm1"] });
const mockSetApiKey = jest.fn().mockResolvedValue(undefined);
const mockClearApiKey = jest.fn().mockResolvedValue(undefined);
const mockGetApiKey = jest.fn().mockResolvedValue("existing-key");
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockBulkSet = jest.fn().mockResolvedValue([]);
const mockEnableModel = jest.fn().mockResolvedValue(undefined);
const mockRemoveRefs = jest.fn().mockResolvedValue(undefined);
const mockGetProvider = jest.fn();

const mockApi = {
  adapters: { verifyCredentials: mockVerifyCredentials },
  setup: { byok: { setupProvider: mockSetupProvider } },
  providerRegistry: {
    setApiKey: mockSetApiKey,
    clearApiKey: mockClearApiKey,
    getApiKeyStatus: jest.fn().mockReturnValue("locked"),
    update: mockUpdate,
  },
  configuredModelRegistry: { bulkSet: mockBulkSet },
  backendConfigRegistry: { enableModel: mockEnableModel, removeRefs: mockRemoveRefs },
  coordinator: { removeProvider: jest.fn() },
  catalogService: {
    getProvider: mockGetProvider,
    getAllProviders: jest.fn().mockReturnValue([]),
    ensureLoaded: jest.fn().mockResolvedValue(undefined),
    onChange: jest.fn().mockReturnValue(() => {}),
  },
};
jest.mock("@/modelManagement/ui/ModelManagementContext", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook
  useModelManagement: () => mockApi,
}));
const mockChatConnection = jest.fn<Promise<VerificationResult>, [unknown]>();
jest.mock("@/LLMProviders/testProviderConnection", () => ({
  testProviderConnection: (input: unknown) => mockChatConnection(input),
}));
// eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real `useApp` hook; the name must match the export
jest.mock("@/context", () => ({ useApp: () => ({}) }));
jest.mock("@/modelManagement/state/atoms", () => {
  const jotai = jest.requireActual<typeof import("jotai")>("jotai");
  return {
    byokProvidersAtom: jotai.atom([
      {
        providerId: "p1",
        apiKeyRef: "saved-p1",
        providerType: "anthropic",
        displayName: "Anthropic",
        baseUrl: "https://api.anthropic.com",
        origin: { kind: "byok", catalogProviderId: "anthropic" },
        addedAt: 0,
      },
      {
        providerId: "p-custom",
        apiKeyRef: "saved-custom",
        providerType: "openai-compatible",
        displayName: "Custom",
        baseUrl: "https://proxy.example/v1",
        requiresApiKey: false,
        extras: { openAIOrgId: "org-keep", unknownField: { retained: true } },
        origin: { kind: "byok" },
        addedAt: 0,
      },
      {
        providerId: "p-catalog-proxy",
        apiKeyRef: "saved-proxy",
        providerType: "anthropic",
        displayName: "Private Anthropic",
        baseUrl: "https://my-proxy.example/v1",
        requiresApiKey: true,
        origin: { kind: "byok", catalogProviderId: "anthropic" },
        extras: { unknownField: "keep" },
        addedAt: 0,
      },
      {
        providerId: "p-kimi",
        providerType: "openai-compatible",
        displayName: "Kimi",
        baseUrl: "https://api.moonshot.cn/v1",
        extras: { presetId: "kimi" },
        origin: { kind: "byok" },
        addedAt: 0,
      },
      {
        providerId: "p-alibaba",
        providerType: "openai-compatible",
        displayName: "阿里云百炼",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        extras: { presetId: "catalog-alibaba-cn" },
        origin: { kind: "byok", catalogProviderId: "alibaba-cn" },
        addedAt: 0,
      },
    ]),
    configuredModelsAtom: jotai.atom([
      {
        configuredModelId: "cm1",
        providerId: "p1",
        info: {
          id: "claude-sonnet",
          displayName: "Claude Sonnet 4.5",
          limits: { context: 200000 },
        },
        configuredAt: 0,
      },
      {
        configuredModelId: "cm2",
        providerId: "p1",
        info: { id: "claude-opus", displayName: "Claude Opus 4.5" },
        configuredAt: 0,
      },
      {
        configuredModelId: "cm-proxy",
        providerId: "p-catalog-proxy",
        info: { id: "claude-private", displayName: "Claude Private" },
        configuredAt: 0,
      },
      {
        configuredModelId: "cm-custom",
        providerId: "p-custom",
        info: { id: "work-model", displayName: "Work model" },
        configuredAt: 0,
      },
      {
        configuredModelId: "cm-kimi",
        providerId: "p-kimi",
        info: { id: "my-kimi-model", displayName: "My Kimi" },
        configuredAt: 0,
      },
      {
        configuredModelId: "cm-alibaba",
        providerId: "p-alibaba",
        info: { id: "my-qwen-model", displayName: "My Qwen" },
        configuredAt: 0,
      },
    ]),
  };
});
jest.mock("@/settings/model", () => {
  const jotai = jest.requireActual<typeof import("jotai")>("jotai");
  return { settingsStore: jotai.createStore() };
});
jest.mock("@/components/ui/password-input", () => ({
  PasswordInput: ({
    value,
    onChange,
    disabled,
  }: {
    value?: string;
    onChange?: (v: string) => void;
    disabled?: boolean;
  }) => (
    <input
      data-testid="api-key"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));
const mockListProviderModels = jest.fn<Promise<unknown>, unknown[]>();
jest.mock("@/modelManagement/providers/adapters/listProviderModels", () => ({
  listProviderModels: (...args: unknown[]) => mockListProviderModels(...args),
}));

import type { CatalogProvider } from "@/modelManagement/types/catalog";
import type { ProviderDefinition } from "@/modelManagement/types/runtime";
import { CUSTOM_OPENAI_DEFINITION } from "@/modelManagement/catalog/builtinDefinitions";
import { ConfigureProviderForm } from "./ConfigureProviderDialog";

afterEach(() => jest.restoreAllMocks());

beforeEach(() => {
  jest.clearAllMocks();
  mockGetApiKey.mockResolvedValue("existing-key");
  mockListProviderModels.mockResolvedValue({ ok: true, modelIds: [] });
  mockChatConnection.mockReset().mockResolvedValue({ ok: true, checkedAt: 1 });
  mockGetProvider.mockReset();
  mockApi.catalogService.getAllProviders.mockReturnValue([]);
  mockSetupProvider.mockClear();
  mockBulkSet.mockResolvedValue(["cm1", "cm2", "cm3"]);
});

const anthropicSource: ProviderDefinition = {
  id: "anthropic",
  displayName: "Anthropic",
  providerType: "anthropic",
  defaultBaseUrl: "https://api.anthropic.com",
  requiresApiKey: true,
  modelInputHint: "e.g. claude-sonnet-5",
  catalogProviderId: "anthropic",
};

const openaiSource: ProviderDefinition = {
  id: "openai",
  displayName: "OpenAI",
  providerType: "openai-compatible",
  requiresApiKey: true,
  modelInputHint: "e.g. gpt-5",
  catalogProviderId: "openai",
};

const ollamaSource: ProviderDefinition = {
  id: "ollama",
  displayName: "Ollama",
  providerType: "openai-compatible",
  defaultBaseUrl: "http://localhost:11434/v1",
  requiresApiKey: false,
  modelInputHint: "e.g. llama3.2",
};

function makeCatalogEntry(
  id: string,
  displayName: string,
  defaultBaseUrl: string
): CatalogProvider {
  return { id, displayName, providerType: "openai-compatible", defaultBaseUrl, models: {} };
}

const alibabaPseudoSource: ProviderDefinition = {
  id: "catalog-alibaba-cn",
  displayName: "阿里云百炼",
  providerType: "openai-compatible",
  defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  requiresApiKey: true,
  modelInputHint: "e.g. qwen3-max",
  catalogProviderId: "alibaba-cn",
  presetId: "catalog-alibaba-cn",
};

const kimiSource: ProviderDefinition = {
  id: "kimi",
  displayName: "Kimi",
  providerType: "openai-compatible",
  defaultBaseUrl: "https://api.moonshot.cn/v1",
  requiresApiKey: true,
  modelInputHint: "e.g. kimi-k3.1-pro",
  catalogProviderId: "moonshotai",
  presetId: "kimi",
};

const anthropicCatalogMetadata = {
  id: "anthropic",
  displayName: "Anthropic",
  providerType: "anthropic" as const,
  defaultBaseUrl: "https://api.anthropic.com",
  models: {
    "claude-sonnet": {
      id: "claude-sonnet",
      displayName: "Claude Sonnet 4.5",
      limits: { context: 200000 },
    },
    "claude-opus": { id: "claude-opus", displayName: "Claude Opus 4.5" },
    "claude-haiku": { id: "claude-haiku", displayName: "Claude Haiku 4.5" },
    "voyage-embed": { id: "voyage-embed", displayName: "Voyage Embed", isEmbedding: true },
    "image-generator": {
      id: "image-generator",
      displayName: "Image generator",
      modalities: { output: ["image"] },
    },
    "speech-model": { id: "speech-model", displayName: "Speech model", family: "text-to-speech" },
    "rerank-v3": { id: "rerank-v3", displayName: "Reranker" },
    "gpt-realtime": { id: "gpt-realtime", displayName: "Realtime model" },
  },
};

function openModelPicker(): void {
  fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
}

function backFromModelList(): void {
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
}

function manualAddId(id: string): void {
  openModelPicker();
  fireEvent.change(screen.getByTestId("model-checklist-manual-input"), { target: { value: id } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  backFromModelList();
}

function rowCheckbox(id: string): HTMLElement {
  const row = within(screen.getByTestId("model-checklist")).getByTestId(`model-row-${id}`);
  return within(row).getByRole("checkbox");
}

function selectedRowCheckbox(id: string): HTMLElement {
  const row = within(screen.getByTestId("selected-model-list")).getByTestId(`model-row-${id}`);
  return within(row).getByRole("checkbox");
}

function baseUrlInput(): HTMLInputElement {
  return screen.getByText("Base URL").parentElement!.querySelector("input")!;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Save" });
}

function chatTestButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Test chat connection" });
}

describe("ConfigureProviderDialog", () => {
  describe("ConfigureProviderForm", () => {
    it.each([
      ["Anthropic", anthropicSource],
      ["OpenAI", openaiSource],
      ["Ollama", ollamaSource],
      ["Custom", CUSTOM_OPENAI_DEFINITION],
    ] as const)(
      "offers manual model entry and discovery for %s without automatically sending a chat",
      async (_name, source) => {
        render(<ConfigureProviderForm state={{ mode: "new", source }} onClose={jest.fn()} />);
        expect(screen.getByTestId("selected-model-list-empty")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Fetch models" })).toBeTruthy();
        openModelPicker();
        expect(screen.getByTestId("model-checklist-manual-input")).toBeTruthy();
        expect(mockChatConnection).not.toHaveBeenCalled();
        await act(async () => {
          await mockApi.catalogService.ensureLoaded.mock.results[
            mockApi.catalogService.ensureLoaded.mock.results.length - 1
          ].value;
        });
      }
    );

    it(`replaces the configuration view with the model list on fetch and restores the entered form on back`, () => {
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: anthropicSource }}
          onClose={jest.fn()}
        />
      );
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "key-to-keep" } });
      openModelPicker();
      expect(screen.queryByRole("region", { name: "Settings" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
      expect(screen.getByRole("heading", { name: "Model list" })).toBeTruthy();
      expect(screen.getByTestId("model-checklist-empty")).toBeTruthy();
      backFromModelList();
      expect(screen.getByRole("region", { name: "Settings" })).toBeTruthy();
      expect(screen.getByTestId("selected-model-list-empty")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
      expect(screen.getByTestId("api-key")).toHaveProperty("value", "key-to-keep");
    });

    it(`saves a hand-entered model without depending on a directory or chat check — https://github.com/ItsDalk-Lane/Scribe/issues/51`, async () => {
      const onSaved = jest.fn();
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: anthropicSource }}
          onClose={jest.fn()}
          onSaved={onSaved}
        />
      );
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "entered-key" } });
      manualAddId("private-model");
      fireEvent.click(saveButton());
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(mockVerifyCredentials).not.toHaveBeenCalled();
      expect(mockChatConnection).not.toHaveBeenCalled();
      expect(screen.queryByRole("switch", { name: "Enable CORS" })).toBeNull();
      expect(mockSetupProvider.mock.calls[0][0]).not.toHaveProperty("enableCors");
      expect(mockSetupProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "entered-key",
          models: [expect.objectContaining({ id: "private-model" })],
        })
      );
    });

    it(`offers catalog model metadata when listing is forbidden and still allows saving a selection`, async () => {
      mockGetProvider.mockReturnValue(anthropicCatalogMetadata);
      mockListProviderModels.mockResolvedValue({
        ok: false,
        message: "HTTP 403: listing is not permitted",
      });
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: anthropicSource }}
          onClose={jest.fn()}
        />
      );
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "chat-capable-key" } });
      openModelPicker();
      expect(await screen.findByText("HTTP 403: listing is not permitted")).toBeTruthy();
      fireEvent.click(rowCheckbox("claude-sonnet"));
      backFromModelList();
      expect(saveButton().disabled).toBe(false);
      fireEvent.click(saveButton());
      await waitFor(() => expect(mockSetupProvider).toHaveBeenCalledTimes(1));
      expect(mockSetupProvider.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          models: [expect.objectContaining({ id: "claude-sonnet", limits: { context: 200000 } })],
        })
      );
      expect(mockChatConnection).not.toHaveBeenCalled();
    });

    it(`fetches a typed custom URL with current inputs without calling the old credential verifier`, async () => {
      mockListProviderModels.mockResolvedValue({ ok: true, modelIds: ["served-model"] });
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: CUSTOM_OPENAI_DEFINITION }}
          onClose={jest.fn()}
        />
      );
      fireEvent.change(baseUrlInput(), { target: { value: "https://custom.example/v1" } });
      fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
      expect(await screen.findByTestId("model-row-served-model")).toBeTruthy();
      expect(mockListProviderModels).toHaveBeenCalledWith(
        "openai-compatible",
        "https://custom.example/v1",
        expect.objectContaining({ apiKey: null })
      );
      expect(mockVerifyCredentials).not.toHaveBeenCalled();
      expect(screen.queryByText("Chat connection verified")).toBeNull();
    });

    it(`sends one explicit chat test with the selected model and current unsaved configuration — https://github.com/ItsDalk-Lane/Scribe/issues/51`, async () => {
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: CUSTOM_OPENAI_DEFINITION }}
          onClose={jest.fn()}
        />
      );
      fireEvent.change(baseUrlInput(), { target: { value: "https://chat.example/v1" } });
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "current-key" } });
      manualAddId("chat-model");
      fireEvent.click(chatTestButton());
      expect(await screen.findByText("Chat connection verified")).toBeTruthy();
      expect(mockChatConnection).toHaveBeenCalledTimes(1);
      expect(
        (mockChatConnection.mock.calls[0][0] as TestProviderConnectionInput).provider
      ).not.toHaveProperty("enableCors");
      expect(mockChatConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "current-key",
          model: expect.objectContaining({ id: "chat-model" }) as unknown,
          provider: expect.objectContaining({
            baseUrl: "https://chat.example/v1",
          }) as unknown,
        })
      );
      expect(mockSetupProvider).not.toHaveBeenCalled();
    });

    it(`limits the test-model selector to checked chat-capable models`, async () => {
      mockGetProvider.mockReturnValue(anthropicCatalogMetadata);
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: anthropicSource }}
          onClose={jest.fn()}
        />
      );
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "key" } });
      openModelPicker();
      fireEvent.click(rowCheckbox("claude-sonnet"));
      fireEvent.click(rowCheckbox("claude-haiku"));
      fireEvent.click(rowCheckbox("voyage-embed"));
      for (const id of ["image-generator", "speech-model", "rerank-v3", "gpt-realtime"])
        fireEvent.click(rowCheckbox(id));
      backFromModelList();
      const picker = screen.getByRole("combobox", { name: "Test model" });
      expect(
        within(picker)
          .getAllByRole("option")
          .map((option) => (option as HTMLOptionElement).value)
      ).toEqual(["claude-sonnet", "claude-haiku"]);
      fireEvent.change(picker, { target: { value: "claude-haiku" } });
      fireEvent.click(chatTestButton());
      await screen.findByText("Chat connection verified");
      expect(mockChatConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ id: "claude-haiku" }) as unknown,
        })
      );
    });

    it.each([true, false])(
      `discards an old chat result after the key changes instead of changing the new input's status: %s`,
      async (ok) => {
        let finish!: (value: VerificationResult) => void;
        const pending = new Promise<VerificationResult>((resolve) => {
          finish = resolve;
        });
        mockChatConnection.mockReturnValueOnce(pending);
        render(
          <ConfigureProviderForm
            state={{ mode: "edit", providerId: "p-custom" }}
            onClose={jest.fn()}
          />
        );
        await screen.findByTestId("api-key");
        fireEvent.click(chatTestButton());
        fireEvent.change(screen.getByTestId("api-key"), { target: { value: "new-key" } });
        await act(async () => {
          finish({
            ok,
            code: ok ? undefined : "invalid_api_key",
            message: ok ? undefined : "Old invalid key",
            checkedAt: 1,
          });
          await pending;
        });
        expect(screen.queryByText("Chat connection verified")).toBeNull();
        expect(screen.queryByText("Old invalid key")).toBeNull();
        expect(saveButton().disabled).toBe(false);
      }
    );

    it(`does not end a newer chat test when an obsolete request finishes`, async () => {
      let finishOld!: (value: VerificationResult) => void;
      let finishNew!: (value: VerificationResult) => void;
      const oldRequest = new Promise<VerificationResult>((resolve) => {
        finishOld = resolve;
      });
      const newRequest = new Promise<VerificationResult>((resolve) => {
        finishNew = resolve;
      });
      mockChatConnection.mockReturnValueOnce(oldRequest).mockReturnValueOnce(newRequest);
      render(
        <ConfigureProviderForm
          state={{ mode: "edit", providerId: "p-custom" }}
          onClose={jest.fn()}
        />
      );
      await screen.findByTestId("api-key");
      fireEvent.click(chatTestButton());
      fireEvent.change(baseUrlInput(), { target: { value: "https://next.example/v1" } });
      fireEvent.click(chatTestButton());
      await act(async () => {
        finishOld({ ok: false, message: "Old failure", checkedAt: 1 });
        await oldRequest;
      });
      expect(
        screen.getByRole("button", { name: "Testing chat connection…" }).hasAttribute("disabled")
      ).toBe(true);
      expect(screen.queryByText("Old failure")).toBeNull();
      await act(async () => {
        finishNew({ ok: true, checkedAt: 2 });
        await newRequest;
      });
      expect(screen.getByText("Chat connection verified")).toBeTruthy();
    });

    it(`allows a fresh chat check after late catalog metadata replaces the pending snapshot`, async () => {
      let finishOld!: (value: VerificationResult) => void;
      const oldRequest = new Promise<VerificationResult>((resolve) => {
        finishOld = resolve;
      });
      mockChatConnection.mockReturnValueOnce(oldRequest);
      const view = render(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={jest.fn()} />
      );
      await screen.findByTestId("api-key");
      fireEvent.click(chatTestButton());
      mockGetProvider.mockReturnValue({
        ...anthropicCatalogMetadata,
        npm: "@ai-sdk/anthropic",
        defaultBaseUrl: "https://catalog.example/anthropic",
      });
      view.rerender(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={jest.fn()} />
      );
      fireEvent.click(chatTestButton());
      expect(mockChatConnection).toHaveBeenCalledTimes(2);
      expect(await screen.findByText("Chat connection verified")).toBeTruthy();
      await act(async () => {
        finishOld({ ok: false, message: "Old snapshot failure", checkedAt: 1 });
        await oldRequest;
      });
      expect(screen.queryByText("Old snapshot failure")).toBeNull();
    });

    it(`lets Cohere choose its native API explicitly while retaining the address and clearing the previous chat result`, async () => {
      render(
        <ConfigureProviderForm
          state={{
            mode: "new",
            source: {
              id: "cohere",
              catalogProviderId: "cohere",
              npm: "@ai-sdk/cohere",
              providerType: "openai-compatible",
              displayName: "Cohere",
              modelInputHint: "Model ID",
              requiresApiKey: true,
            },
          }}
          onClose={jest.fn()}
        />
      );
      const apiFormat = screen.getByRole<HTMLSelectElement>("combobox", { name: "API format" });
      expect(apiFormat.value).toBe("compatible");
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "fixture-key" } });
      fireEvent.change(baseUrlInput(), {
        target: { value: "https://proxy.example/compatibility/v1" },
      });
      manualAddId("command-a");
      fireEvent.click(chatTestButton());
      await screen.findByText("Chat connection verified");
      const compatible = mockChatConnection.mock.calls[0][0] as TestProviderConnectionInput;
      expect(resolveProviderConnection(compatible.provider, compatible.model)).toMatchObject({
        npm: "@ai-sdk/openai-compatible",
        baseUrl: "https://proxy.example/compatibility/v1",
      });
      fireEvent.change(screen.getByRole<HTMLSelectElement>("combobox", { name: "API format" }), {
        target: { value: "native" },
      });
      expect(screen.queryByText("Chat connection verified")).toBeNull();
      expect(baseUrlInput().value).toBe("https://proxy.example/compatibility/v1");
      fireEvent.change(baseUrlInput(), { target: { value: "https://api.cohere.com/v2" } });
      fireEvent.click(chatTestButton());
      await screen.findByText("Chat connection verified");
      const native = mockChatConnection.mock.calls[1][0] as TestProviderConnectionInput;
      expect(native.provider.extras).toMatchObject({ apiProtocol: "native" });
      expect(resolveProviderConnection(native.provider, native.model)).toMatchObject({
        npm: "@ai-sdk/cohere",
        baseUrl: "https://api.cohere.com/v2",
      });
      fireEvent.click(saveButton());
      await waitFor(() => expect(mockSetupProvider).toHaveBeenCalled());
      expect(mockSetupProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "https://api.cohere.com/v2",
          extras: expect.objectContaining({ apiProtocol: "native" }) as unknown,
        })
      );
    });

    it(`requires an explicit native Cohere address instead of reusing the compatibility default`, async () => {
      render(
        <ConfigureProviderForm
          state={{
            mode: "new",
            source: {
              id: "cohere",
              catalogProviderId: "cohere",
              npm: "@ai-sdk/cohere",
              providerType: "openai-compatible",
              displayName: "Cohere",
              modelInputHint: "Model ID",
              requiresApiKey: true,
            },
          }}
          onClose={jest.fn()}
        />
      );
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "fixture-key" } });
      manualAddId("command-a");
      fireEvent.change(screen.getByRole("combobox", { name: "API format" }), {
        target: { value: "native" },
      });
      expect(saveButton().disabled).toBe(true);
      expect(chatTestButton().disabled).toBe(true);
      expect(screen.getByText("A base URL is required for this provider.")).toBeTruthy();
      fireEvent.change(baseUrlInput(), { target: { value: "https://api.cohere.com/v2" } });
      expect(saveButton().disabled).toBe(false);
      expect(chatTestButton().disabled).toBe(false);
      await act(async () => {
        await mockApi.catalogService.ensureLoaded.mock.results.at(-1)!.value;
      });
    });

    it(`does not offer a native API switch for a provider without a native implementation`, async () => {
      render(
        <ConfigureProviderForm
          state={{
            mode: "new",
            source: {
              id: "vercel",
              catalogProviderId: "vercel",
              npm: "@ai-sdk/gateway",
              providerType: "openai-compatible",
              displayName: "Vercel",
              modelInputHint: "Model ID",
              requiresApiKey: true,
            },
          }}
          onClose={jest.fn()}
        />
      );
      expect(screen.queryByRole("combobox", { name: "API format" })).toBeNull();
      await act(async () => {
        await mockApi.catalogService.ensureLoaded.mock.results.at(-1)!.value;
      });
    });

    it.each([
      { mode: "new", source: anthropicSource },
      { mode: "edit", providerId: "p1" },
    ] as const)(
      `keeps the title and save controls outside the scrolling fields for $mode mode with forty models`,
      async (state) => {
        const models = Object.fromEntries(
          Array.from({ length: 40 }, (_, index) => {
            const id =
              index === 0 ? "claude-sonnet" : index === 1 ? "claude-opus" : `model-${index}`;
            return [id, { id, displayName: `Long chat model ${index}` }];
          })
        );
        mockGetProvider.mockReturnValue({ ...anthropicCatalogMetadata, models });
        render(<ConfigureProviderForm state={state} onClose={jest.fn()} />);
        const settings = await screen.findByRole("region", { name: "Settings" });
        expect(settings.contains(screen.getByTestId("api-key"))).toBe(true);
        if (state.mode === "edit") {
          expect(
            within(screen.getByTestId("selected-model-list")).getAllByRole("listitem")
          ).toHaveLength(2);
        } else {
          expect(screen.getByTestId("selected-model-list-empty")).toBeTruthy();
        }
        expect(
          settings.contains(screen.getByRole("heading", { name: "Configure Anthropic" }))
        ).toBe(false);
        expect(settings.contains(saveButton())).toBe(false);
        expect(settings.contains(screen.getByRole("button", { name: "Cancel" }))).toBe(false);
        if (state.mode === "edit")
          expect(settings.contains(screen.getByRole("button", { name: "Remove provider" }))).toBe(
            false
          );
        openModelPicker();
        expect(within(screen.getByTestId("model-checklist")).getAllByRole("listitem")).toHaveLength(
          40
        );
        expect(screen.queryByRole("region", { name: "Settings" })).toBeNull();
        expect(screen.queryByRole("heading", { name: "Configure Anthropic" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
        expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
        await act(async () => {
          await mockApi.catalogService.ensureLoaded.mock.results.at(-1)!.value;
        });
      }
    );

    it(`requires the running QVAC server address before saving or testing without inventing a default`, async () => {
      render(
        <ConfigureProviderForm
          state={{
            mode: "new",
            source: {
              id: "qvac",
              catalogProviderId: "qvac",
              npm: "@qvac/ai-sdk-provider",
              providerType: "openai-compatible",
              displayName: "QVAC",
              modelInputHint: "Model ID",
              requiresApiKey: true,
            },
          }}
          onClose={jest.fn()}
        />
      );
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "server-key" } });
      manualAddId("local-chat-model");
      expect(saveButton().disabled).toBe(true);
      expect(chatTestButton().disabled).toBe(true);
      expect(screen.getByText("A base URL is required for this provider.")).toBeTruthy();
      expect(
        screen.getByText(
          "Enter the base URL of your running QVAC server. No default address is assumed."
        )
      ).toBeTruthy();
      fireEvent.change(baseUrlInput(), { target: { value: "http://localhost:9000/v1" } });
      expect(saveButton().disabled).toBe(false);
      fireEvent.click(chatTestButton());
      expect(await screen.findByText("Chat connection verified")).toBeTruthy();
      expect(mockChatConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: expect.objectContaining({ baseUrl: "http://localhost:9000/v1" }) as unknown,
        })
      );
    });

    it(`allows SAP configuration without a separate base URL because its service key carries the address`, async () => {
      render(
        <ConfigureProviderForm
          state={{
            mode: "new",
            source: {
              id: "sap-ai-core",
              catalogProviderId: "sap-ai-core",
              npm: "@jerome-benoit/sap-ai-provider-v2",
              providerType: "openai-compatible",
              displayName: "SAP AI Core",
              modelInputHint: "Model ID",
              requiresApiKey: true,
            },
          }}
          onClose={jest.fn()}
        />
      );
      const secret = JSON.stringify({
        clientid: "fixture",
        clientsecret: "fixture-secret",
        url: "https://auth.example",
        serviceurls: { AI_API_URL: "https://core.example" },
      });
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: secret } });
      manualAddId("chat-model");
      expect(saveButton().disabled).toBe(false);
      expect(chatTestButton().disabled).toBe(false);
      fireEvent.click(saveButton());
      await waitFor(() => expect(mockSetupProvider).toHaveBeenCalled());
      expect(mockSetupProvider).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: secret, baseUrl: undefined })
      );
    });

    it.each([
      ["sap-ai-core", "@jerome-benoit/sap-ai-provider-v2"],
      ["gitlab", "gitlab-ai-provider"],
    ])(
      `allows saving and explicitly testing %s on mobile with the current credential`,
      async (id, npm) => {
        jest.replaceProperty(Platform, "isDesktopApp", false);
        jest.replaceProperty(Platform, "isMobile", true);
        render(
          <ConfigureProviderForm
            state={{
              mode: "new",
              source: {
                id,
                catalogProviderId: id,
                npm,
                providerType: "openai-compatible",
                displayName: id,
                modelInputHint: "Model ID",
                requiresApiKey: true,
              },
            }}
            onClose={jest.fn()}
          />
        );
        const credential =
          id === "sap-ai-core"
            ? JSON.stringify({
                clientid: "fixture",
                clientsecret: "fixture-secret",
                url: "https://auth.example",
                serviceurls: { AI_API_URL: "https://core.example" },
              })
            : "fixture-gitlab-token";
        fireEvent.change(screen.getByTestId("api-key"), { target: { value: credential } });
        manualAddId("chat-model");
        expect(saveButton().disabled).toBe(false);
        expect(chatTestButton().disabled).toBe(false);
        fireEvent.click(chatTestButton());
        expect(await screen.findByText("Chat connection verified")).toBeTruthy();
        expect(mockChatConnection).toHaveBeenCalledTimes(1);
        expect(mockChatConnection).toHaveBeenCalledWith(
          expect.objectContaining({
            apiKey: credential,
            provider: expect.objectContaining({
              origin: expect.objectContaining({ catalogProviderId: id }) as unknown,
            }) as unknown,
          })
        );
      }
    );

    it.each([
      [
        "privatemode-ai",
        "Start the official Privatemode proxy before connecting to localhost:8080. The proxy handles encryption and verification; when it holds your API key, a placeholder key is enough here.",
      ],
      [
        "tinfoil",
        "A normal Tinfoil HTTPS connection does not verify the secure enclave. For verified privacy, run the official Tinfoil proxy and use its local base URL, usually http://127.0.0.1:3301/v1.",
      ],
    ])(
      `explains %s privacy prerequisites without removing the provider`,
      async (id, instruction) => {
        render(
          <ConfigureProviderForm
            state={{
              mode: "new",
              source: {
                id,
                catalogProviderId: id,
                providerType: "openai-compatible",
                displayName: id,
                modelInputHint: "Model ID",
                defaultBaseUrl:
                  id === "privatemode-ai"
                    ? "http://localhost:8080/v1"
                    : "https://inference.tinfoil.sh/v1",
                requiresApiKey: true,
              },
            }}
            onClose={jest.fn()}
          />
        );
        expect(screen.getByText(instruction)).toBeTruthy();
        expect(screen.getByTestId("api-key")).toBeTruthy();
        await act(async () => {
          await mockApi.catalogService.ensureLoaded.mock.results.at(-1)!.value;
        });
      }
    );

    it.each([
      {
        id: "cloudflare-ai-gateway",
        npm: "ai-gateway-provider",
        template:
          "https://gateway.ai.cloudflare.com/v1/${CLOUDFLARE_ACCOUNT_ID}/${CLOUDFLARE_GATEWAY_ID}/compat",
        fields: [
          ["Cloudflare account ID", "account"],
          ["Cloudflare gateway ID", "gateway"],
        ],
        model: {
          id: "anthropic/claude-fixture",
          displayName: "Claude fixture",
          provider: {
            npm: "@ai-sdk/anthropic",
            api: "https://gateway.ai.cloudflare.com/v1/${CLOUDFLARE_ACCOUNT_ID}/${CLOUDFLARE_GATEWAY_ID}/anthropic/v1",
          },
        },
        expected: {
          npm: "@ai-sdk/openai-compatible",
          baseUrl: "https://gateway.ai.cloudflare.com/v1/account/gateway/compat",
          shape: "completions",
        },
      },
      {
        id: "neon",
        npm: "@ai-sdk/openai-compatible",
        template: "${NEON_AI_GATEWAY_BASE_URL}/v1",
        fields: [["Neon AI Gateway base URL", "https://gateway.neon.example"]],
        model: {
          id: "openai/gpt-fixture",
          displayName: "GPT fixture",
          provider: {
            npm: "@ai-sdk/openai",
            api: "${NEON_AI_GATEWAY_BASE_URL}/openai/v1",
            shape: "responses" as const,
          },
        },
        expected: {
          npm: "@ai-sdk/openai",
          baseUrl: "https://gateway.neon.example/openai/v1",
          shape: "responses",
        },
      },
    ])(
      `uses the same saved template and resolved chat route for $id when testing and saving`,
      async ({ id, npm, template, fields, model, expected }) => {
        mockGetProvider.mockReturnValue({
          id,
          npm,
          defaultBaseUrl: template,
          models: { [model.id]: model },
        });
        render(
          <ConfigureProviderForm
            state={{
              mode: "new",
              source: {
                id,
                catalogProviderId: id,
                providerType: "openai-compatible",
                displayName: id,
                npm,
                defaultBaseUrl: template,
                modelInputHint: "Model ID",
                requiresApiKey: true,
              },
            }}
            onClose={jest.fn()}
          />
        );
        fireEvent.change(screen.getByTestId("api-key"), { target: { value: "fixture-key" } });
        for (const [label, value] of fields)
          fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });
        openModelPicker();
        fireEvent.click(rowCheckbox(model.id));
        backFromModelList();
        fireEvent.click(chatTestButton());
        await screen.findByText("Chat connection verified");
        const tested = mockChatConnection.mock.calls[0][0] as TestProviderConnectionInput;
        expect(tested.provider.baseUrl).toBe(template);
        expect(resolveProviderConnection(tested.provider, tested.model)).toMatchObject(expected);
        fireEvent.click(saveButton());
        await waitFor(() => expect(mockSetupProvider).toHaveBeenCalledTimes(1));
        const saved = mockSetupProvider.mock.calls[0][0] as SetupProviderInput;
        expect(saved.baseUrl).toBe(template);
        expect(
          resolveProviderConnection(
            { ...tested.provider, baseUrl: saved.baseUrl, extras: saved.extras },
            saved.models[0]
          )
        ).toEqual(resolveProviderConnection(tested.provider, tested.model));
      }
    );

    it(`renders profile parameters and retains the original template in test and save snapshots`, async () => {
      const template =
        "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1";
      const source: ProviderDefinition = {
        id: "cloudflare-workers-ai",
        displayName: "Cloudflare Workers AI",
        providerType: "openai-compatible",
        catalogProviderId: "cloudflare-workers-ai",
        defaultBaseUrl: template,
        npm: "@ai-sdk/openai-compatible",
        requiresApiKey: true,
        modelInputHint: "Model ID",
      };
      render(<ConfigureProviderForm state={{ mode: "new", source }} onClose={jest.fn()} />);
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "cloud-secret" } });
      manualAddId("@cf/model");
      expect(saveButton().disabled).toBe(true);
      fireEvent.change(screen.getByRole("textbox", { name: "Cloudflare account ID" }), {
        target: { value: "account-123" },
      });
      fireEvent.click(chatTestButton());
      await screen.findByText("Chat connection verified");
      expect(mockChatConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: expect.objectContaining({
            baseUrl: template,
          }) as unknown,
        })
      );
      fireEvent.click(saveButton());
      await waitFor(() => expect(mockSetupProvider).toHaveBeenCalledTimes(1));
      expect(mockSetupProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: template,
          extras: expect.objectContaining({
            CLOUDFLARE_ACCOUNT_ID: "account-123",
            npm: "@ai-sdk/openai-compatible",
            catalogBaseUrl: template,
          }) as unknown,
        })
      );
    });

    it(`keeps the stored key encrypted while preserving the custom endpoint and extras without a connection-mode switch — https://github.com/ItsDalk-Lane/Scribe/issues/51`, async () => {
      render(
        <ConfigureProviderForm
          state={{ mode: "edit", providerId: "p-custom" }}
          onClose={jest.fn()}
        />
      );
      expect((await screen.findByTestId<HTMLInputElement>("api-key")).value).toBe("");
      expect(mockGetApiKey).not.toHaveBeenCalled();
      expect(screen.queryByRole("switch", { name: "Enable CORS" })).toBeNull();
      fireEvent.click(saveButton());
      await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
      expect(mockUpdate.mock.calls[0][1]).not.toHaveProperty("enableCors");
      expect(mockUpdate).toHaveBeenCalledWith(
        "p-custom",
        expect.objectContaining({
          baseUrl: "https://proxy.example/v1",
          extras: expect.objectContaining({
            openAIOrgId: "org-keep",
            unknownField: { retained: true },
          }) as unknown,
        })
      );
      expect(mockSetApiKey).not.toHaveBeenCalled();
      expect(mockVerifyCredentials).not.toHaveBeenCalled();
    });

    it(`uses the latest catalog metadata for legacy saves without replacing a custom endpoint`, async () => {
      render(
        <ConfigureProviderForm
          state={{ mode: "edit", providerId: "p-catalog-proxy" }}
          onClose={jest.fn()}
        />
      );
      await screen.findByTestId("api-key");
      mockGetProvider.mockReturnValue({
        ...anthropicCatalogMetadata,
        npm: "@ai-sdk/anthropic",
        defaultBaseUrl: "https://catalog.example/anthropic",
      });
      fireEvent.click(saveButton());
      await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
      expect(mockUpdate).toHaveBeenCalledWith(
        "p-catalog-proxy",
        expect.objectContaining({
          baseUrl: "https://my-proxy.example/v1",
          extras: expect.objectContaining({
            npm: "@ai-sdk/anthropic",
            catalogBaseUrl: "https://catalog.example/anthropic",
            unknownField: "keep",
          }) as unknown,
        })
      );
    });

    it(`keeps service-account JSON only in the credential and supplies profile defaults as public parameters`, async () => {
      const source: ProviderDefinition = {
        id: "google-vertex",
        displayName: "Vertex",
        providerType: "google",
        catalogProviderId: "google-vertex",
        npm: "@ai-sdk/google-vertex",
        requiresApiKey: true,
        modelInputHint: "Model ID",
      };
      const credential = JSON.stringify({
        type: "service_account",
        client_email: "fixture@example.test",
        private_key: "fixture-private-key",
      });
      render(<ConfigureProviderForm state={{ mode: "new", source }} onClose={jest.fn()} />);
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: credential } });
      fireEvent.change(screen.getByRole("textbox", { name: "Google Cloud project ID" }), {
        target: { value: "fixture-project" },
      });
      expect(
        screen.getByRole<HTMLInputElement>("textbox", { name: "Google Cloud location" }).value
      ).toBe("global");
      manualAddId("gemini-test");
      fireEvent.click(saveButton());
      await waitFor(() => expect(mockSetupProvider).toHaveBeenCalled());
      expect(mockSetupProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: credential,
          extras: expect.objectContaining({
            GOOGLE_VERTEX_PROJECT: "fixture-project",
            GOOGLE_VERTEX_LOCATION: "global",
          }) as unknown,
        })
      );
      expect(
        JSON.stringify((mockSetupProvider.mock.calls[0][0] as { extras: unknown }).extras)
      ).not.toContain("fixture-private-key");
    });

    it(`clears an optional stored credential rather than re-reading it while discovering or saving`, async () => {
      render(
        <ConfigureProviderForm
          state={{ mode: "edit", providerId: "p-custom" }}
          onClose={jest.fn()}
        />
      );
      await screen.findByTestId("api-key");
      fireEvent.click(screen.getByTestId("api-key-clear"));
      fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
      await waitFor(() =>
        expect(mockListProviderModels).toHaveBeenLastCalledWith(
          "openai-compatible",
          "https://proxy.example/v1",
          expect.objectContaining({ apiKey: null })
        )
      );
      backFromModelList();
      fireEvent.click(saveButton());
      await waitFor(() => expect(mockClearApiKey).toHaveBeenCalledWith("p-custom"));
      expect(mockGetApiKey).not.toHaveBeenCalled();
    });

    it(`disables all connection inputs while their save is pending`, async () => {
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      mockUpdate.mockReturnValueOnce(pending);
      render(
        <ConfigureProviderForm
          state={{ mode: "edit", providerId: "p-custom" }}
          onClose={jest.fn()}
        />
      );
      await screen.findByTestId("api-key");
      fireEvent.click(saveButton());
      await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
      expect(screen.getByTestId<HTMLInputElement>("api-key").disabled).toBe(true);
      expect(baseUrlInput().disabled).toBe(true);
      await act(async () => {
        finish();
        await pending;
      });
    });

    it(`removes backend references for deselected saved models and enrolls only new chat models`, async () => {
      mockGetProvider.mockReturnValue(anthropicCatalogMetadata);
      render(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={jest.fn()} />
      );
      await screen.findByTestId("api-key");
      openModelPicker();
      fireEvent.click(rowCheckbox("claude-opus"));
      fireEvent.click(rowCheckbox("claude-haiku"));
      fireEvent.click(rowCheckbox("voyage-embed"));
      fireEvent.click(rowCheckbox("image-generator"));
      fireEvent.click(rowCheckbox("speech-model"));
      backFromModelList();
      fireEvent.click(saveButton());
      await waitFor(() => expect(mockRemoveRefs).toHaveBeenCalledWith(["cm2"]));
      expect(mockEnableModel).toHaveBeenCalledWith("chat", "cm2");
      expect(mockEnableModel).toHaveBeenCalledTimes(1);
    });

    it("prefills the representative version's recommended models and renders plan and region controls for a multi-version preset", () => {
      render(
        <ConfigureProviderForm state={{ mode: "new", source: kimiSource }} onClose={jest.fn()} />
      );
      expect(screen.getByRole("radiogroup", { name: "Preset plan" })).toBeTruthy();
      expect(screen.getByRole("radiogroup", { name: "Preset region" })).toBeTruthy();
      expect(selectedRowCheckbox("kimi-k3.1-pro").getAttribute("aria-checked")).toBe("true");
    });

    it("switching the plan or region retargets the endpoint and replaces the recommended selection", () => {
      render(
        <ConfigureProviderForm state={{ mode: "new", source: kimiSource }} onClose={jest.fn()} />
      );
      fireEvent.click(
        within(screen.getByRole("radiogroup", { name: "Preset plan" })).getByRole("radio", {
          name: "Coding subscription",
        })
      );
      expect(baseUrlInput().value).toBe("https://api.kimi.com/coding");
      expect(selectedRowCheckbox("kimi-for-coding").getAttribute("aria-checked")).toBe("true");
      openModelPicker();
      expect(rowCheckbox("kimi-k3.1-pro").getAttribute("aria-checked")).toBe("false");
      backFromModelList();
      fireEvent.click(
        within(screen.getByRole("radiogroup", { name: "Preset region" })).getByRole("radio", {
          name: "International",
        })
      );
      expect(baseUrlInput().value).toBe("https://api.kimi.ai/coding");
    });

    it("renders no version controls for sources without a preset", () => {
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: anthropicSource }}
          onClose={jest.fn()}
        />
      );
      expect(screen.queryByText("Version")).toBeNull();
      expect(screen.queryByRole("radiogroup", { name: "Preset plan" })).toBeNull();
    });

    it("restores the version controls from saved extras and switches only the endpoint in edit mode", () => {
      render(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p-kimi" }} onClose={jest.fn()} />
      );
      expect(screen.getByRole("radiogroup", { name: "Preset plan" })).toBeTruthy();
      expect(baseUrlInput().value).toBe("https://api.moonshot.cn/v1");
      expect(selectedRowCheckbox("my-kimi-model").getAttribute("aria-checked")).toBe("true");
      fireEvent.click(
        within(screen.getByRole("radiogroup", { name: "Preset plan" })).getByRole("radio", {
          name: "Coding subscription",
        })
      );
      expect(baseUrlInput().value).toBe("https://api.kimi.com/coding");
      expect(selectedRowCheckbox("my-kimi-model").getAttribute("aria-checked")).toBe("true");
      expect(screen.queryByTestId("model-row-kimi-for-coding")).toBeNull();
    });

    it("lists catalog-backed pseudo versions for a mapped family and switching retargets the endpoint", () => {
      mockApi.catalogService.getAllProviders.mockReturnValue([
        makeCatalogEntry(
          "alibaba",
          "Alibaba Cloud Model Studio",
          "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
        ),
        makeCatalogEntry(
          "alibaba-cn",
          "Alibaba Cloud (CN)",
          "https://dashscope.aliyuncs.com/compatible-mode/v1"
        ),
        makeCatalogEntry(
          "alibaba-coding-plan",
          "Alibaba Coding Plan",
          "https://coding-intl.dashscope.aliyuncs.com/v1"
        ),
        makeCatalogEntry(
          "alibaba-coding-plan-cn",
          "Alibaba Coding Plan (CN)",
          "https://coding.dashscope.aliyuncs.com/v1"
        ),
        makeCatalogEntry(
          "alibaba-token-plan",
          "Alibaba Token Plan",
          "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
        ),
        makeCatalogEntry(
          "alibaba-token-plan-cn",
          "Alibaba Token Plan (CN)",
          "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
        ),
      ]);
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: alibabaPseudoSource }}
          onClose={jest.fn()}
        />
      );
      const versionGroup = screen.getByRole("radiogroup", { name: "Version" });
      expect(within(versionGroup).getAllByRole("radio")).toHaveLength(6);
      expect(baseUrlInput().value).toBe("");
      fireEvent.click(
        within(versionGroup).getByRole("radio", { name: "coding.dashscope.aliyuncs.com" })
      );
      expect(baseUrlInput().value).toBe("https://coding.dashscope.aliyuncs.com/v1");
    });

    it("restores catalog-backed pseudo versions from saved extras in edit mode without resetting models", () => {
      mockApi.catalogService.getAllProviders.mockReturnValue([
        makeCatalogEntry(
          "alibaba",
          "Alibaba Cloud Model Studio",
          "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
        ),
        makeCatalogEntry(
          "alibaba-cn",
          "Alibaba Cloud (CN)",
          "https://dashscope.aliyuncs.com/compatible-mode/v1"
        ),
        makeCatalogEntry(
          "alibaba-coding-plan",
          "Alibaba Coding Plan",
          "https://coding-intl.dashscope.aliyuncs.com/v1"
        ),
        makeCatalogEntry(
          "alibaba-coding-plan-cn",
          "Alibaba Coding Plan (CN)",
          "https://coding.dashscope.aliyuncs.com/v1"
        ),
        makeCatalogEntry(
          "alibaba-token-plan",
          "Alibaba Token Plan",
          "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
        ),
        makeCatalogEntry(
          "alibaba-token-plan-cn",
          "Alibaba Token Plan (CN)",
          "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
        ),
      ]);
      render(
        <ConfigureProviderForm
          state={{ mode: "edit", providerId: "p-alibaba" }}
          onClose={jest.fn()}
        />
      );
      const versionGroup = screen.getByRole("radiogroup", { name: "Version" });
      expect(within(versionGroup).getAllByRole("radio")).toHaveLength(6);
      expect(baseUrlInput().value).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
      expect(selectedRowCheckbox("my-qwen-model").getAttribute("aria-checked")).toBe("true");
      fireEvent.click(
        within(versionGroup).getByRole("radio", { name: "coding.dashscope.aliyuncs.com" })
      );
      expect(baseUrlInput().value).toBe("https://coding.dashscope.aliyuncs.com/v1");
      expect(selectedRowCheckbox("my-qwen-model").getAttribute("aria-checked")).toBe("true");
    });

    it("persists the chosen preset id in extras when saving a new provider", async () => {
      const onSaved = jest.fn();
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: kimiSource }}
          onClose={jest.fn()}
          onSaved={onSaved}
        />
      );
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "entered-key" } });
      fireEvent.click(saveButton());
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      const setupCall = mockSetupProvider.mock.calls[0][0] as { extras?: Record<string, unknown> };
      expect(setupCall.extras?.presetId).toBe("kimi");
    });
  });
});
