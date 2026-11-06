import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ProviderModelTable, type ProviderModelGroup } from "./ProviderModelTable";
import { ModelManagementProvider } from "@/modelManagement/ui/ModelManagementContext";
import { createModelManagement } from "@/modelManagement/createModelManagement";
import { AppContext } from "@/context";
import type { App } from "obsidian";
import { setInterfaceLocale } from "@/lib/i18n";

beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

const mockApp = {
  vault: { adapter: { exists: jest.fn() } },
} as unknown as App;

const api = createModelManagement({ app: mockApp });

const group: ProviderModelGroup = {
  provider: {
    providerId: "p1",
    providerType: "anthropic",
    displayName: "Anthropic",
    origin: { kind: "byok", catalogProviderId: "anthropic" },
    addedAt: 0,
    requiresApiKey: true,
    apiKeyRef: "key1",
  },
  verification: { ok: true, checkedAt: 0 },
  models: [
    {
      configuredModelId: "m1",
      providerId: "p1",
      info: {
        id: "claude-sonnet",
        displayName: "Claude Sonnet 4.5",
        limits: { context: 200000 },
        releaseDate: "2025-09-01",
      },
      configuredAt: 0,
    },
    {
      configuredModelId: "m2",
      providerId: "p1",
      info: { id: "claude-opus", displayName: "Claude Opus 4.5" },
      configuredAt: 0,
    },
  ],
};

const renderWithProvider = (ui: React.ReactElement) =>
  render(
    <AppContext.Provider value={mockApp}>
      <ModelManagementProvider api={api}>{ui}</ModelManagementProvider>
    </AppContext.Provider>
  );

describe("ProviderModelTable", () => {
  describe("ProviderModelTable", () => {
    it("shows the empty state when there are no groups", () => {
      renderWithProvider(
        <ProviderModelTable groups={[]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );
      expect(screen.getByTestId("byok-table-empty")).toBeTruthy();
    });

    it("lists the provider's models after the provider card is expanded", () => {
      renderWithProvider(
        <ProviderModelTable groups={[group]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );
      expect(screen.getByText("Anthropic")).toBeTruthy();

      fireEvent.click(screen.getByText("Anthropic"));
      expect(screen.getByText("Claude Sonnet 4.5")).toBeTruthy();
      expect(screen.getByText("Claude Opus 4.5")).toBeTruthy();
    });

    it("names where each provider sends requests", () => {
      const local: ProviderModelGroup = {
        provider: {
          ...group.provider,
          providerId: "p2",
          displayName: "LM Studio",
          baseUrl: "http://localhost:1234/v1",
        },
        models: [],
      };
      renderWithProvider(
        <ProviderModelTable groups={[group, local]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );
      expect(screen.getByText("Sends requests to: Anthropic")).toBeTruthy();
      expect(screen.getByText("Sends requests to: A server on this computer")).toBeTruthy();
    });

    it("shows the model count and a Endpoint accessible badge for a verified provider", () => {
      renderWithProvider(
        <ProviderModelTable groups={[group]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );
      expect(screen.getByText("2 models")).toBeTruthy();
      expect(screen.getByText("Endpoint accessible")).toBeTruthy();
    });

    it("shows No key instead of Endpoint accessible when verification reports a missing key", () => {
      const noKeyGroup: ProviderModelGroup = {
        provider: { ...group.provider, apiKeyRef: undefined },
        models: group.models,
        verification: { ok: false, code: "missing_api_key", checkedAt: 0 },
      };
      renderWithProvider(
        <ProviderModelTable groups={[noKeyGroup]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );
      expect(screen.getByText("No key")).toBeTruthy();
      expect(screen.queryByText("Endpoint accessible")).toBeNull();
    });

    it("says No models added instead of 0 models when a keyed provider has none", () => {
      const emptyGroup: ProviderModelGroup = { ...group, models: [] };
      renderWithProvider(
        <ProviderModelTable groups={[emptyGroup]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );
      expect(screen.getByText("No models added")).toBeTruthy();
      expect(screen.queryByText("0 models")).toBeNull();
      expect(screen.getByText("Endpoint accessible")).toBeTruthy();
    });

    it("shows Checking… instead of Endpoint accessible for a keyless provider until verification returns", () => {
      const localGroup: ProviderModelGroup = {
        provider: { ...group.provider, displayName: "Ollama", requiresApiKey: false },
        models: [],
      };
      renderWithProvider(
        <ProviderModelTable groups={[localGroup]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );
      expect(screen.getByText("No API key required")).toBeTruthy();
      expect(screen.getByText("Checking…")).toBeTruthy();
      expect(screen.queryByText("Endpoint accessible")).toBeNull();
    });

    it("describes a keyless remote provider without calling it a local model", () => {
      const remote: ProviderModelGroup = {
        provider: {
          ...group.provider,
          providerType: "openai-compatible",
          displayName: "Public gateway",
          baseUrl: "https://models.example.com/v1",
          requiresApiKey: false,
        },
        models: [],
      };
      renderWithProvider(
        <ProviderModelTable groups={[remote]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );
      expect(screen.getByText("No API key required")).toBeTruthy();
      expect(screen.getByText("Sends requests to: Public gateway")).toBeTruthy();
      expect(screen.queryByText("Local models on your machine")).toBeNull();
    });

    it("describes a keyless remote provider accurately in Chinese", () => {
      const remote: ProviderModelGroup = {
        provider: {
          ...group.provider,
          providerType: "openai-compatible",
          displayName: "Public gateway",
          baseUrl: "https://models.example.com/v1",
          requiresApiKey: false,
        },
        models: [],
      };
      setInterfaceLocale("zh-CN");
      try {
        renderWithProvider(
          <ProviderModelTable groups={[remote]} onConfigure={jest.fn()} onRemove={jest.fn()} />
        );
        expect(screen.getByText("无需 API 密钥")).toBeTruthy();
        expect(screen.getByText("请求发送至：Public gateway")).toBeTruthy();
      } finally {
        setInterfaceLocale("en");
      }
    });

    it("toggles the model list each time the provider card is clicked", () => {
      renderWithProvider(
        <ProviderModelTable groups={[group]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );

      expect(screen.queryByText("Claude Sonnet 4.5")).toBeNull();

      fireEvent.click(screen.getByText("Anthropic"));
      expect(screen.getByText("Claude Sonnet 4.5")).toBeTruthy();

      fireEvent.click(screen.getByText("Anthropic"));
      expect(screen.queryByText("Claude Sonnet 4.5")).toBeNull();
    });

    it("toggles the model list from the keyboard with Enter and Space on the focusable card header", () => {
      renderWithProvider(
        <ProviderModelTable groups={[group]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );

      const header = screen.getByRole("button", { name: /2 models/i });
      expect(header.getAttribute("tabindex")).toBe("0");
      expect(header.getAttribute("aria-expanded")).toBe("false");

      fireEvent.keyDown(header, { key: "Enter" });
      expect(screen.getByText("Claude Sonnet 4.5")).toBeTruthy();
      expect(header.getAttribute("aria-expanded")).toBe("true");

      fireEvent.keyDown(header, { key: " " });
      expect(screen.queryByText("Claude Sonnet 4.5")).toBeNull();
      expect(header.getAttribute("aria-expanded")).toBe("false");
    });

    it("offers a keyboard-reachable Remove button for each model once expanded", () => {
      renderWithProvider(
        <ProviderModelTable groups={[group]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );
      fireEvent.click(screen.getByText("Anthropic"));

      const removeBtn = screen.getByRole("button", { name: "Remove Claude Sonnet 4.5" });
      expect(removeBtn).toBeTruthy();
      expect(removeBtn.getAttribute("tabindex")).toBe("0");
    });
  });
});
