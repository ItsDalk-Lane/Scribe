import { setInterfaceLocale } from "@/lib/i18n";
import type { CatalogProvider } from "@/modelManagement/types/catalog";
import type { ProviderDefinition } from "@/modelManagement/types/runtime";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { AddProviderContent } from "./AddProviderDialog";

beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

function makeCatalog(
  id: string,
  displayName: string,
  defaultBaseUrl?: string,
  providerType?: CatalogProvider["providerType"]
): CatalogProvider {
  return {
    id,
    displayName,
    providerType: providerType ?? (id === "anthropic" ? "anthropic" : "openai-compatible"),
    defaultBaseUrl,
    models: {},
  };
}

const catalog: CatalogProvider[] = [
  makeCatalog("anthropic", "Anthropic"),
  makeCatalog("openai", "OpenAI"),
  makeCatalog("google", "Google"),
  makeCatalog("groq", "Groq"),
];

const localTemplates: ProviderDefinition[] = [
  {
    id: "ollama",
    displayName: "Ollama",
    providerType: "openai-compatible",
    defaultBaseUrl: "http://localhost:11434/v1",
    requiresApiKey: false,
    modelInputHint: "e.g. llama3.2",
  },
  {
    id: "lmstudio",
    displayName: "LM Studio",
    providerType: "openai-compatible",
    defaultBaseUrl: "http://localhost:1234/v1",
    requiresApiKey: false,
    modelInputHint: "e.g. qwen2.5",
  },
];

const customTemplate: ProviderDefinition = {
  id: "custom-openai-compatible",
  displayName: "Custom OpenAI-compatible",
  providerType: "openai-compatible",
  requiresApiKey: true,
  modelInputHint: "e.g. gpt-5.5",
};

function renderDialog(overrides: Partial<React.ComponentProps<typeof AddProviderContent>> = {}) {
  const props: React.ComponentProps<typeof AddProviderContent> = {
    catalogProviders: catalog,
    localTemplates,
    customTemplate,
    onPick: jest.fn(),
    ...overrides,
  };
  render(<AddProviderContent {...props} />);
  return props;
}

describe("AddProviderDialog", () => {
  describe("AddProviderContent", () => {
    afterEach(() => setInterfaceLocale("en"));

    it("shows Chinese categories and the merged family card without changing selected provider details", () => {
      setInterfaceLocale("zh-CN");
      const onPick = jest.fn();
      renderDialog({ onPick });
      expect(screen.getByPlaceholderText("搜索供应商…")).toBeTruthy();
      expect(screen.getByText("全部")).toBeTruthy();
      expect(screen.getAllByText("国外官方").length).toBeGreaterThan(0);
      expect(screen.getAllByText("聚合平台").length).toBeGreaterThan(0);
      expect(screen.getByText("platform.kimi.com · 4 个版本")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "添加 Ollama 供应商" }));
      expect(onPick).toHaveBeenCalledWith(localTemplates[0]);
    });

    it("keeps the recommended catalog vendors on the first screen next to preset family cards", () => {
      renderDialog();
      expect(screen.getByTestId("add-provider-card-anthropic")).toBeTruthy();
      expect(screen.getByTestId("add-provider-card-openai")).toBeTruthy();
      expect(screen.getByTestId("add-provider-family-google")).toBeTruthy();
      expect(screen.queryByTestId("add-provider-card-groq")).toBeNull();
      expect(screen.getByTestId("add-provider-family-kimi")).toBeTruthy();
    });

    it("merges same-vendor preset versions into one card labeled with the version count", () => {
      renderDialog();
      expect(screen.getByTestId("add-provider-family-tencent")).toBeTruthy();
      expect(screen.getByText("cloud.tencent.com · 8 versions")).toBeTruthy();
    });

    it("shows only providers matching the search query across catalog and preset groups", () => {
      renderDialog();
      fireEvent.change(screen.getByPlaceholderText("Search providers…"), {
        target: { value: "openai" },
      });
      expect(screen.queryByTestId("add-provider-card-anthropic")).toBeNull();
      expect(screen.queryByTestId("add-provider-template-ollama")).toBeNull();
      expect(screen.getByTestId("add-provider-card-openai")).toBeTruthy();
    });

    it("finds a merged family card by its vendor name", () => {
      renderDialog();
      fireEvent.change(screen.getByPlaceholderText("Search providers…"), {
        target: { value: "kimi" },
      });
      expect(screen.queryByTestId("add-provider-card-anthropic")).toBeNull();
      expect(screen.getByTestId("add-provider-family-kimi")).toBeTruthy();
    });

    it("filters cards to the chosen category from the sidebar", () => {
      renderDialog();
      fireEvent.click(screen.getByTestId("add-provider-category-cloud_provider"));
      expect(screen.getByTestId("add-provider-card-preset-ollama-cloud")).toBeTruthy();
      expect(screen.queryByTestId("add-provider-card-groq")).toBeNull();
      expect(screen.queryByTestId("add-provider-family-kimi")).toBeNull();
    });

    it("lists local runners and the local preset in their own category", () => {
      renderDialog();
      expect(screen.getByTestId("add-provider-template-ollama")).toBeTruthy();
      expect(screen.getByTestId("add-provider-template-lmstudio")).toBeTruthy();
      expect(screen.getByTestId("add-provider-card-preset-vllm")).toBeTruthy();
    });

    it("picks a catalog-backed definition requiring an API key when a catalog provider is clicked", () => {
      const onPick = jest.fn();
      renderDialog({ onPick });
      fireEvent.click(screen.getByTestId("add-provider-card-anthropic"));
      expect(onPick).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "anthropic",
          providerType: "anthropic",
          catalogProviderId: "anthropic",
          requiresApiKey: true,
        })
      );
    });

    it("picks the first version of a merged family with the family display name and preset id", () => {
      const onPick = jest.fn();
      renderDialog({ onPick });
      fireEvent.click(screen.getByTestId("add-provider-family-kimi"));
      expect(onPick).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "kimi",
          presetId: "kimi",
          displayName: "Kimi",
          providerType: "openai-compatible",
          defaultBaseUrl: "https://api.moonshot.cn/v1",
          catalogProviderId: "moonshotai",
        })
      );
    });

    it("picks a single preset with its own preset id", () => {
      const onPick = jest.fn();
      renderDialog({ onPick });
      fireEvent.click(screen.getByTestId("add-provider-card-preset-tokenplus"));
      expect(onPick).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "tokenplus",
          presetId: "tokenplus",
          catalogProviderId: undefined,
        })
      );
    });

    it("hides a catalog vendor that a preset already covers at the same endpoint", () => {
      renderDialog({
        catalogProviders: [makeCatalog("deepseek", "DeepSeek", "https://api.deepseek.com/v1")],
      });
      expect(screen.queryByTestId("add-provider-card-deepseek")).toBeNull();
      expect(screen.getByTestId("add-provider-card-preset-deep-seek")).toBeTruthy();
    });

    it("keeps official direct vendors even when a relay preset references their models", () => {
      renderDialog();
      expect(screen.getByTestId("add-provider-card-anthropic")).toBeTruthy();
    });

    it("hides a catalog vendor variant by endpoint host even when the catalog id differs from the preset linkage", () => {
      renderDialog({
        catalogProviders: [
          makeCatalog("moonshotai-cn", "Moonshot AI (CN)", "https://api.moonshot.cn/v1"),
        ],
      });
      expect(screen.queryByTestId("add-provider-card-moonshotai-cn")).toBeNull();
      expect(screen.getByTestId("add-provider-family-kimi")).toBeTruthy();
    });

    it("hides a catalog vendor that only matches a local template id", () => {
      renderDialog({
        catalogProviders: [makeCatalog("lmstudio", "LM Studio", "http://127.0.0.1:1234/v1")],
      });
      expect(screen.queryByTestId("add-provider-card-lmstudio")).toBeNull();
      expect(screen.getByTestId("add-provider-template-lmstudio")).toBeTruthy();
    });

    it("merges mapped catalog-only vendors into one family card as selectable versions", () => {
      renderDialog({
        catalogProviders: [
          makeCatalog(
            "alibaba-cn",
            "Alibaba Cloud (CN)",
            "https://dashscope.aliyuncs.com/compatible-mode/v1"
          ),
          makeCatalog(
            "alibaba-token-plan",
            "Alibaba Token Plan",
            "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
          ),
        ],
      });
      expect(screen.queryByTestId("add-provider-card-alibaba-cn")).toBeNull();
      expect(screen.queryByTestId("add-provider-card-alibaba-token-plan")).toBeNull();
      expect(screen.getByTestId("add-provider-family-alibaba")).toBeTruthy();
      expect(screen.getByText("dashscope.aliyuncs.com · 2 versions")).toBeTruthy();
    });

    it("skips a mapped catalog vendor whose endpoint host is already covered by a preset version", () => {
      renderDialog({
        catalogProviders: [
          makeCatalog(
            "alibaba-coding-plan",
            "Alibaba Coding Plan",
            "https://coding-intl.dashscope.aliyuncs.com/v1"
          ),
        ],
      });
      expect(screen.queryByTestId("add-provider-card-alibaba-coding-plan")).toBeNull();
      expect(screen.queryByTestId("add-provider-family-alibaba")).toBeNull();
    });

    it("picks the first catalog version of a catalog-only family with its pseudo preset id", () => {
      const onPick = jest.fn();
      renderDialog({
        catalogProviders: [
          makeCatalog(
            "alibaba-cn",
            "Alibaba Cloud (CN)",
            "https://dashscope.aliyuncs.com/compatible-mode/v1"
          ),
          makeCatalog(
            "alibaba-token-plan",
            "Alibaba Token Plan",
            "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
          ),
        ],
        onPick,
      });
      fireEvent.click(screen.getByTestId("add-provider-family-alibaba"));
      expect(onPick).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "catalog-alibaba-cn",
          presetId: "catalog-alibaba-cn",
          displayName: "Alibaba Cloud",
          defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          catalogProviderId: "alibaba-cn",
        })
      );
    });

    it("preserves the catalog package when a provider is selected", () => {
      const onPick = jest.fn();
      renderDialog({ catalogProviders: [{ ...catalog[0], npm: "@ai-sdk/anthropic" }], onPick });
      fireEvent.click(screen.getByTestId("add-provider-card-anthropic"));
      expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ npm: "@ai-sdk/anthropic" }));
    });

    it("hints at Claude model ids when the Anthropic provider is picked", () => {
      const onPick = jest.fn();
      renderDialog({ onPick });
      fireEvent.click(screen.getByTestId("add-provider-card-anthropic"));
      expect(onPick.mock.calls[0][0].modelInputHint).toMatch(/claude/i);
    });

    it("picks the local template as-is, without a catalog id, when a local runner is clicked", () => {
      const onPick = jest.fn();
      renderDialog({ onPick });
      fireEvent.click(screen.getByTestId("add-provider-template-ollama"));
      expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "ollama" }));
      expect(onPick.mock.calls[0][0].catalogProviderId).toBeUndefined();
    });

    it("classifies unclaimed catalog vendors into the new international official category", () => {
      renderDialog({
        catalogProviders: [makeCatalog("anthropic", "Anthropic"), makeCatalog("cohere", "Cohere")],
      });
      fireEvent.click(screen.getByTestId("add-provider-category-intl_official"));
      expect(screen.getByTestId("add-provider-card-anthropic")).toBeTruthy();
      expect(screen.getByTestId("add-provider-card-cohere")).toBeTruthy();
      expect(screen.queryByTestId("add-provider-card-tokenplus")).toBeNull();
    });

    it("places user-named relays such as Poe into the third-party category", () => {
      renderDialog({
        catalogProviders: [makeCatalog("poe", "Poe", "https://api.poe.com")],
      });
      fireEvent.click(screen.getByTestId("add-provider-category-third_party"));
      expect(screen.getByTestId("add-provider-card-poe")).toBeTruthy();
      fireEvent.click(screen.getByTestId("add-provider-category-aggregator"));
      expect(screen.queryByTestId("add-provider-card-poe")).toBeNull();
    });

    it("merges the hostless google catalog variants into one international official family", () => {
      renderDialog({
        catalogProviders: [
          makeCatalog("google", "Google", undefined, "google"),
          makeCatalog("google-vertex", "Google Vertex AI", undefined, "google"),
          makeCatalog("google-vertex-anthropic", "Google Vertex (Anthropic)", undefined, "google"),
        ],
      });
      expect(screen.queryByTestId("add-provider-card-google")).toBeNull();
      expect(screen.queryByTestId("add-provider-card-google-vertex")).toBeNull();
      expect(screen.getByTestId("add-provider-family-google")).toBeTruthy();
      const card = screen.getByTestId("add-provider-family-google");
      expect(card.textContent).toContain("3 versions");
    });

    it("picks the representative catalog version of the merged google family", () => {
      const onPick = jest.fn();
      renderDialog({
        catalogProviders: [
          makeCatalog("google", "Google", undefined, "google"),
          makeCatalog("google-vertex", "Google Vertex AI", undefined, "google"),
          makeCatalog("google-vertex-anthropic", "Google Vertex (Anthropic)", undefined, "google"),
        ],
        onPick,
      });
      fireEvent.click(screen.getByTestId("add-provider-family-google"));
      expect(onPick).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "catalog-google",
          presetId: "catalog-google",
          displayName: "Google",
          providerType: "google",
        })
      );
    });

    it("hides a hostless catalog entry that a preset already covers", () => {
      renderDialog({ catalogProviders: [makeCatalog("groq", "Groq")] });
      expect(screen.queryByTestId("add-provider-card-groq")).toBeNull();
    });

    it("picks the custom OpenAI-compatible definition, without a catalog id, from the CTA", () => {
      const onPick = jest.fn();
      renderDialog({ onPick });
      fireEvent.click(screen.getByTestId("add-provider-custom-cta"));
      expect(onPick).toHaveBeenCalledWith(
        expect.objectContaining({ id: "custom-openai-compatible" })
      );
      expect(onPick.mock.calls[0][0].catalogProviderId).toBeUndefined();
    });

    it.each([["Enter"], ["Space", " "]])(
      "activates the custom-provider CTA with the %s key",
      (_name, key = _name) => {
        const onPick = jest.fn();
        renderDialog({ onPick });
        fireEvent.keyDown(screen.getByTestId("add-provider-custom-cta"), { key });
        expect(onPick).toHaveBeenCalledWith(
          expect.objectContaining({ id: "custom-openai-compatible" })
        );
      }
    );
  });
});
