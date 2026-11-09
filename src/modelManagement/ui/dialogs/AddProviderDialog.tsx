import { t } from "@/lib/i18n";
import { ReactModal } from "@/components/modals/ReactModal";
import { SearchBar } from "@/components/ui/SearchBar";
import { cn } from "@/lib/utils";
import type { CatalogProvider, ProviderType } from "@/modelManagement/types/catalog";
import type { ProviderDefinition } from "@/modelManagement/types/runtime";
import {
  PROVIDER_PRESETS,
  type ProviderPreset,
} from "@/modelManagement/catalog/presets/providerPresets";
import { PRESET_FAMILIES } from "@/modelManagement/catalog/presets/presetFamilies";
import type { PresetFamilyId } from "@/modelManagement/catalog/presets/presetFamilies";
import { getPresetIcon } from "@/modelManagement/catalog/presets/presetIcons";
import { Plus } from "lucide-react";
import { App } from "obsidian";
import React, { useMemo, useState } from "react";

const RECOMMENDED_IDS: readonly string[] = ["anthropic", "openai", "google"];

const PROVIDER_TYPE_HINTS: Record<ProviderType, string> = {
  anthropic: "e.g. claude-sonnet-5",
  google: "e.g. gemini-2.5-pro",
  "openai-compatible": "e.g. gpt-5",
};

const PICKER_CATEGORY_ORDER = [
  "all",
  "cn_official",
  "aggregator",
  "third_party",
  "cloud_provider",
  "vendors",
  "local",
] as const;

type PickerCategory = (typeof PICKER_CATEGORY_ORDER)[number];

const CATEGORY_LABEL_KEYS: Record<PickerCategory, string> = {
  all: "All providers",
  cn_official: "Domestic official",
  aggregator: "Aggregator platforms",
  third_party: "Third-party platforms",
  cloud_provider: "Cloud providers",
  vendors: "Model vendors",
  local: "Local inference",
};

const SECTION_ORDER: readonly Exclude<PickerCategory, "all">[] = [
  "cn_official",
  "aggregator",
  "third_party",
  "cloud_provider",
  "vendors",
  "local",
];

const OFFICIAL_DIRECT_CATALOG_IDS: ReadonlySet<string> = new Set(["anthropic", "openai", "google"]);

function catalogToDefinition(catalog: CatalogProvider): ProviderDefinition {
  return {
    id: catalog.id,
    displayName: catalog.displayName,
    providerType: catalog.providerType,
    defaultBaseUrl: catalog.defaultBaseUrl,
    requiresApiKey: true,
    modelInputHint: t(PROVIDER_TYPE_HINTS[catalog.providerType] ?? "Add a model id"),
    catalogProviderId: catalog.id,
    npm: catalog.npm,
  };
}

function presetToDefinition(preset: ProviderPreset, displayName: string): ProviderDefinition {
  return {
    id: preset.id,
    displayName,
    providerType: preset.providerType,
    defaultBaseUrl: preset.baseUrl,
    requiresApiKey: preset.requiresApiKey,
    modelInputHint: t(PROVIDER_TYPE_HINTS[preset.providerType] ?? "Add a model id"),
    catalogProviderId: preset.catalogProviderId,
    presetId: preset.id,
  };
}

function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export interface AddProviderContentProps {
  catalogProviders: readonly CatalogProvider[];
  localTemplates: readonly ProviderDefinition[];
  customTemplate: ProviderDefinition;
  onPick: (source: ProviderDefinition) => void;
}

interface PickerCard {
  key: string;
  testId: string;
  displayName: string;
  detail: string;
  searchText: string;
  icon?: string;
  iconColor?: string;
  pick: () => void;
}

interface PickerSection {
  category: Exclude<PickerCategory, "all">;
  cards: PickerCard[];
}

function matchesQuery(card: PickerCard, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return card.searchText.toLowerCase().includes(needle);
}

export const AddProviderContent: React.FC<AddProviderContentProps> = ({
  catalogProviders,
  localTemplates,
  customTemplate,
  onPick,
}) => {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PickerCategory>("all");

  const customCard = useMemo<PickerCard>(
    () => ({
      key: "custom",
      testId: "add-provider-custom-cta",
      displayName: t("Add a custom provider"),
      detail: t("custom endpoint"),
      searchText: t("Add a custom provider"),
      pick: () => onPick(customTemplate),
    }),
    [customTemplate, onPick]
  );

  const sections = useMemo<PickerSection[]>(() => {
    const byCategory = new Map<Exclude<PickerCategory, "all">, PickerCard[]>();

    const push = (target: Exclude<PickerCategory, "all">, card: PickerCard): void => {
      byCategory.set(target, [...(byCategory.get(target) ?? []), card]);
    };

    const versionsByFamily = new Map<PresetFamilyId, ProviderPreset[]>();
    for (const preset of PROVIDER_PRESETS) {
      if (!preset.family) continue;
      const versions = versionsByFamily.get(preset.family) ?? [];
      versions.push(preset);
      versionsByFamily.set(preset.family, versions);
    }

    for (const [familyId, versions] of versionsByFamily) {
      const representative = versions[0];
      const familyName = t(PRESET_FAMILIES[familyId].displayName);
      const domain = hostOf(representative.websiteUrl) || hostOf(representative.baseUrl);
      push(representative.category, {
        key: `family-${familyId}`,
        testId: `add-provider-family-${familyId}`,
        displayName: familyName,
        detail:
          versions.length > 1
            ? `${domain} · ${t("{count} versions", { count: versions.length })}`
            : domain,
        searchText: [familyName, ...versions.map((preset) => preset.displayName), domain].join(" "),
        icon: representative.icon,
        iconColor: representative.iconColor,
        pick: () => onPick(presetToDefinition(representative, familyName)),
      });
    }

    for (const preset of PROVIDER_PRESETS) {
      if (preset.family || preset.category === "local") continue;
      const domain = hostOf(preset.websiteUrl) || hostOf(preset.baseUrl);
      push(preset.category, {
        key: `preset-${preset.id}`,
        testId: `add-provider-card-preset-${preset.id}`,
        displayName: preset.displayName,
        detail: domain,
        searchText: [preset.displayName, domain].join(" "),
        icon: preset.icon,
        iconColor: preset.iconColor,
        pick: () => onPick(presetToDefinition(preset, preset.displayName)),
      });
    }

    const claimedCatalogIds = new Set<string>();
    for (const preset of PROVIDER_PRESETS) {
      if (!preset.catalogProviderId || OFFICIAL_DIRECT_CATALOG_IDS.has(preset.catalogProviderId)) {
        continue;
      }
      const catalogProvider = catalogProviders.find(
        (entry) => entry.id === preset.catalogProviderId
      );
      if (!catalogProvider?.defaultBaseUrl) continue;
      if (hostOf(catalogProvider.defaultBaseUrl) === hostOf(preset.baseUrl)) {
        claimedCatalogIds.add(preset.catalogProviderId);
      }
    }

    const catalogCards = catalogProviders
      .filter((provider) => !claimedCatalogIds.has(provider.id))
      .sort((a, b) => {
        const recommendedA = RECOMMENDED_IDS.indexOf(a.id);
        const recommendedB = RECOMMENDED_IDS.indexOf(b.id);
        if (recommendedA !== recommendedB) {
          return (
            (recommendedA === -1 ? Number.MAX_SAFE_INTEGER : recommendedA) -
            (recommendedB === -1 ? Number.MAX_SAFE_INTEGER : recommendedB)
          );
        }
        return a.displayName.localeCompare(b.displayName);
      })
      .map((provider) => {
        const domain = hostOf(provider.defaultBaseUrl) || t("custom endpoint");
        return {
          key: `catalog-${provider.id}`,
          testId: `add-provider-card-${provider.id}`,
          displayName: provider.displayName,
          detail: domain,
          searchText: [provider.displayName, domain].join(" "),
          pick: () => onPick(catalogToDefinition(provider)),
        };
      });
    for (const card of catalogCards) push("vendors", card);

    for (const template of localTemplates) {
      const descriptor = template.defaultBaseUrl
        ? template.defaultBaseUrl.replace(/^https?:\/\//, "")
        : t("custom endpoint");
      push("local", {
        key: `template-${template.id}`,
        testId: `add-provider-template-${template.id}`,
        displayName: t(template.displayName),
        detail: descriptor,
        searchText: [t(template.displayName), descriptor].join(" "),
        pick: () => onPick(template),
      });
    }
    for (const preset of PROVIDER_PRESETS) {
      if (preset.category !== "local") continue;
      const domain = hostOf(preset.baseUrl) || preset.baseUrl;
      push("local", {
        key: `preset-${preset.id}`,
        testId: `add-provider-card-preset-${preset.id}`,
        displayName: preset.displayName,
        detail: domain,
        searchText: [preset.displayName, domain].join(" "),
        icon: preset.icon,
        iconColor: preset.iconColor,
        pick: () => onPick(presetToDefinition(preset, preset.displayName)),
      });
    }

    return SECTION_ORDER.map((categoryKey) => ({
      category: categoryKey,
      cards: (byCategory.get(categoryKey) ?? []).sort((a, b) =>
        a.displayName.localeCompare(b.displayName)
      ),
    }));
  }, [catalogProviders, localTemplates, onPick]);

  const searching = query.trim().length > 0;
  const filteredSections = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        cards: section.cards.filter((card) => matchesQuery(card, query)),
      })),
    [sections, query]
  );
  const visibleSections = filteredSections.filter((section) => section.cards.length > 0);
  const countFor = (target: PickerCategory): number =>
    target === "all"
      ? visibleSections.reduce((sum, section) => sum + section.cards.length, 0)
      : (filteredSections.find((section) => section.category === target)?.cards.length ?? 0);
  const noMatches = countFor("all") === 0;

  const renderCard = (card: PickerCard): React.ReactElement => (
    <KeyboardButton
      key={card.key}
      onClick={card.pick}
      testId={card.testId}
      ariaLabel={t("Add {displayName} provider", { displayName: card.displayName })}
      className={CARD_CLASS}
    >
      <IconTile icon={card.icon} name={card.displayName} />
      <span className="tw-min-w-0 tw-flex-1">
        <span
          className="tw-block tw-truncate tw-text-sm tw-font-medium tw-text-normal"
          title={card.displayName}
        >
          {card.displayName}
        </span>
        <span className="tw-block tw-truncate tw-text-xs tw-text-muted" title={card.detail}>
          {card.detail}
        </span>
      </span>
      <Plus className="tw-size-4 tw-shrink-0 tw-text-muted" />
    </KeyboardButton>
  );

  return (
    <div className="tw-group/settings tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-gap-4 tw-overflow-hidden tw-px-2">
      <div className="tw-text-sm tw-text-muted">{t("Pick a provider to configure.")}</div>

      <SearchBar value={query} onChange={setQuery} placeholder={t("Search providers…")} />

      <div className="tw-flex tw-min-h-0 tw-flex-1 tw-gap-4 tw-overflow-hidden">
        <div
          role="group"
          aria-label={t("Provider categories")}
          className="tw-flex tw-w-[168px] tw-shrink-0 tw-flex-col tw-gap-0.5 tw-overflow-y-auto"
        >
          {PICKER_CATEGORY_ORDER.map((key) => {
            const count = countFor(key);
            const active = category === key;
            const dim = searching && count === 0 && !active;
            return (
              <button
                key={key}
                type="button"
                data-testid={`add-provider-category-${key}`}
                aria-pressed={active}
                onClick={() => setCategory(key)}
                className={cn(
                  "tw-flex tw-h-8 tw-items-center tw-justify-between tw-gap-2 tw-rounded-md tw-px-2 tw-text-left tw-text-sm",
                  active
                    ? "tw-bg-base-25 tw-font-medium tw-text-normal"
                    : "tw-text-normal hover:tw-bg-primary-alt/40",
                  dim && "tw-text-muted"
                )}
              >
                <span className="tw-truncate">{t(CATEGORY_LABEL_KEYS[key])}</span>
                <span className="tw-shrink-0 tw-text-xs tw-tabular-nums tw-text-muted">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="tw-min-w-0 tw-flex-1 tw-overflow-y-auto">
          {category === "all" ? (
            <div className="tw-flex tw-flex-col tw-gap-4">
              <div className="tw-grid tw-grid-cols-2 tw-gap-2">{renderCard(customCard)}</div>
              {visibleSections.map((section) => (
                <section
                  key={section.category}
                  aria-labelledby={`add-provider-section-${section.category}`}
                  className="tw-flex tw-flex-col tw-gap-2"
                >
                  <h3
                    id={`add-provider-section-${section.category}`}
                    className="tw-px-0.5 tw-text-xs tw-font-medium tw-text-muted"
                  >
                    {t(CATEGORY_LABEL_KEYS[section.category])}
                  </h3>
                  <div className="tw-grid tw-grid-cols-2 tw-gap-2">
                    {section.cards.map(renderCard)}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="tw-grid tw-grid-cols-2 tw-gap-2">
              {renderCard(customCard)}
              {(filteredSections.find((section) => section.category === category)?.cards ?? []).map(
                renderCard
              )}
            </div>
          )}

          {noMatches && (
            <div className="tw-mt-2 tw-rounded-md tw-border tw-border-dashed tw-border-border tw-px-4 tw-py-6 tw-text-center tw-text-sm tw-text-muted">
              {t("No providers match your search.")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface KeyboardButtonProps {
  onClick: () => void;
  className: string;
  testId: string;
  ariaLabel: string;
  children: React.ReactNode;
}

const KeyboardButton: React.FC<KeyboardButtonProps> = ({
  onClick,
  className,
  testId,
  ariaLabel,
  children,
}) => (
  <div
    role="button"
    tabIndex={0}
    onClick={onClick}
    onKeyDown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    }}
    data-testid={testId}
    aria-label={ariaLabel}
    className={className}
  >
    {children}
  </div>
);

const CARD_CLASS = cn(
  "tw-flex tw-h-[52px] tw-w-full tw-cursor-pointer tw-items-center tw-gap-3 tw-rounded-md",
  "tw-border tw-border-solid tw-border-border tw-bg-transparent tw-px-3 tw-text-left",
  "hover:tw-border-border hover:tw-bg-primary-alt/40"
);

const IconTile: React.FC<{ icon?: string; name: string }> = ({ icon, name }) => {
  const svg = getPresetIcon(icon);
  if (svg) {
    return (
      <span
        aria-hidden="true"
        className="tw-flex tw-size-8 tw-shrink-0 tw-items-center tw-justify-center tw-text-[18px] tw-leading-none"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="tw-bg-base-10 tw-flex tw-size-8 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md tw-border tw-border-solid tw-border-border tw-text-xs tw-font-semibold tw-text-muted"
    >
      {letter}
    </span>
  );
};

interface AddProviderModalOptions {
  catalogProviders: readonly CatalogProvider[];
  localTemplates: readonly ProviderDefinition[];
  customTemplate: ProviderDefinition;
  onPick: (source: ProviderDefinition) => void;
}

export class AddProviderModal extends ReactModal {
  constructor(
    app: App,
    private readonly opts: AddProviderModalOptions
  ) {
    super(app, t("Add a provider"));
  }

  onOpen(): void {
    this.modalEl.addClasses(["tw-flex", "tw-h-[70vh]", "tw-flex-col"]);
    this.contentEl.addClasses([
      "tw-flex",
      "tw-min-h-0",
      "tw-flex-1",
      "tw-flex-col",
      "tw-overflow-hidden",
    ]);
    super.onOpen();
  }

  protected renderContent(close: () => void): React.ReactElement {
    return (
      <AddProviderContent
        catalogProviders={this.opts.catalogProviders}
        localTemplates={this.opts.localTemplates}
        customTemplate={this.opts.customTemplate}
        onPick={(source) => {
          this.opts.onPick(source);
          close();
        }}
      />
    );
  }
}
