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

    it("offers provider configuration and removal without expanding its model list", () => {
      const onConfigure = jest.fn();
      const onRemove = jest.fn();
      renderWithProvider(
        <ProviderModelTable groups={[group]} onConfigure={onConfigure} onRemove={onRemove} />
      );

      const configure = screen.getByRole("button", { name: "Configure Anthropic" });
      fireEvent.keyDown(configure, { key: "Enter" });
      fireEvent.click(configure);
      fireEvent.click(screen.getByRole("button", { name: "Remove Anthropic" }));

      expect(onConfigure).toHaveBeenCalledWith("p1");
      expect(onRemove).toHaveBeenCalledWith("p1");
      expect(screen.queryByText("Claude Sonnet 4.5")).toBeNull();
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

    it("shows the context and modality labels beside each model name https://github.com/ItsDalk-Lane/Scribe/issues/67", () => {
      const labeled: ProviderModelGroup = {
        ...group,
        models: [
          {
            configuredModelId: "m1",
            providerId: "p1",
            info: {
              id: "claude-sonnet",
              displayName: "Claude Sonnet 4.5",
              limits: { context: 200000 },
              modalities: { input: ["text", "image"], output: ["text"] },
            },
            configuredAt: 0,
          },
        ],
      };
      renderWithProvider(
        <ProviderModelTable groups={[labeled]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );
      fireEvent.click(screen.getByText("Anthropic"));
      expect(screen.getByText("200K")).toBeTruthy();
      expect(screen.getByTestId("model-modality-image")).toBeTruthy();
    });

    it("opens the per-model config from the edit button beside the remove action https://github.com/ItsDalk-Lane/Scribe/issues/67", () => {
      const onEditModel = jest.fn();
      renderWithProvider(
        <ProviderModelTable
          groups={[group]}
          onConfigure={jest.fn()}
          onRemove={jest.fn()}
          onEditModel={onEditModel}
        />
      );
      fireEvent.click(screen.getByText("Anthropic"));
      fireEvent.click(screen.getByLabelText("Configure Claude Sonnet 4.5"));
      expect(onEditModel).toHaveBeenCalledWith("m1");
    });

    it("marks a deprecated configured model while keeping its actions available https://github.com/ItsDalk-Lane/Scribe/issues/67", () => {
      const deprecated: ProviderModelGroup = {
        ...group,
        models: [
          {
            configuredModelId: "m3",
            providerId: "p1",
            info: { id: "old-model", displayName: "Old Model", status: "deprecated" },
            configuredAt: 0,
          },
        ],
      };
      renderWithProvider(
        <ProviderModelTable
          groups={[deprecated]}
          onConfigure={jest.fn()}
          onRemove={jest.fn()}
          onEditModel={jest.fn()}
        />
      );
      fireEvent.click(screen.getByText("Anthropic"));
      expect(screen.getByText("Deprecated")).toBeTruthy();
      expect(screen.getByLabelText("Configure Old Model")).toBeTruthy();
      expect(screen.getByLabelText("Remove Old Model")).toBeTruthy();
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

    it("reflects the selector switch and persists its change through the provider registry https://github.com/ItsDalk-Lane/Scribe/issues/69", () => {
      const update = jest.spyOn(api.providerRegistry, "update").mockResolvedValue(undefined);
      try {
        renderWithProvider(
          <ProviderModelTable groups={[group]} onConfigure={jest.fn()} onRemove={jest.fn()} />
        );
        const toggle = screen.getByRole("switch", {
          name: "Include Anthropic models in model selectors",
        });
        expect(toggle.getAttribute("aria-checked")).toBe("true");
        fireEvent.click(toggle);
        expect(update).toHaveBeenCalledWith("p1", { enabled: false });
      } finally {
        update.mockRestore();
      }
    });

    it("renders a provider switched off for selectors as unchecked with a dimmed name https://github.com/ItsDalk-Lane/Scribe/issues/69", () => {
      const disabled: ProviderModelGroup = {
        ...group,
        provider: { ...group.provider, enabled: false },
      };
      renderWithProvider(
        <ProviderModelTable groups={[disabled]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );
      const toggle = screen.getByRole("switch", {
        name: "Include Anthropic models in model selectors",
      });
      expect(toggle.getAttribute("aria-checked")).toBe("false");
      expect(screen.getByText("Anthropic").className).toContain("tw-opacity-60");
    });

    it("does not expand the card when toggling the selector switch by click or keyboard https://github.com/ItsDalk-Lane/Scribe/issues/69", () => {
      const update = jest.spyOn(api.providerRegistry, "update").mockResolvedValue(undefined);
      try {
        renderWithProvider(
          <ProviderModelTable groups={[group]} onConfigure={jest.fn()} onRemove={jest.fn()} />
        );
        const toggle = screen.getByRole("switch", {
          name: "Include Anthropic models in model selectors",
        });
        const header = screen.getByRole("button", { name: /2 models/i });
        fireEvent.click(toggle);
        expect(header.getAttribute("aria-expanded")).toBe("false");
        expect(screen.queryByText("Claude Sonnet 4.5")).toBeNull();
        fireEvent.keyDown(toggle, { key: "Enter" });
        expect(header.getAttribute("aria-expanded")).toBe("false");
        expect(screen.queryByText("Claude Sonnet 4.5")).toBeNull();
      } finally {
        update.mockRestore();
      }
    });
  });
});
