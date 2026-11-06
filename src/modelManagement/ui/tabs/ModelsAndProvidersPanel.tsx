import { t } from "@/lib/i18n";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/ui/SearchBar";
import { useApp } from "@/context";
import { logError } from "@/logger";
import {
  CUSTOM_OPENAI_DEFINITION,
  LOCAL_PROVIDER_DEFINITIONS,
} from "@/modelManagement/catalog/builtinDefinitions";
import { configuredModelsAtom, visibleByokProvidersAtom } from "@/modelManagement/state/atoms";
import type { CatalogProvider } from "@/modelManagement/types/catalog";
import type { VerificationResult } from "@/modelManagement/types/runtime";
import { ProviderVerificationProgress } from "@/modelManagement/ui/components/ProviderVerificationStatus";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import { useModelManagement } from "@/modelManagement/ui/ModelManagementContext";
import {
  ProviderModelTable,
  type ProviderModelGroup,
} from "@/modelManagement/ui/components/ProviderModelTable";
import { AddProviderModal } from "@/modelManagement/ui/dialogs/AddProviderDialog";
import { ConfigureProviderModal } from "@/modelManagement/ui/dialogs/ConfigureProviderDialog";
import { settingsStore } from "@/settings/model";
import { useAtomValue } from "jotai";
import { Plus } from "lucide-react";
import { Notice } from "obsidian";
import React, { useEffect, useMemo, useState } from "react";

const UNVERIFIED: VerificationResult = Object.freeze({
  ok: false,
  code: "verification_unavailable",
  checkedAt: 0,
});
const EMPTY_VERIFICATION: Readonly<Record<string, VerificationResult>> = Object.freeze({});
const EMPTY_CATALOG: readonly CatalogProvider[] = Object.freeze([]);
const EMPTY_PROVIDERS: readonly Provider[] = Object.freeze([]);
const EMPTY_MODELS: readonly ConfiguredModel[] = Object.freeze([]);

export const ModelsAndProvidersPanel: React.FC = () => {
  const api = useModelManagement();
  const app = useApp();

  const providers = useAtomValue(visibleByokProvidersAtom, { store: settingsStore });
  const configuredModels = useAtomValue(configuredModelsAtom, { store: settingsStore });

  const [catalogProviders, setCatalogProviders] =
    useState<readonly CatalogProvider[]>(EMPTY_CATALOG);
  const [query, setQuery] = useState("");
  const [verification, setVerification] =
    useState<Readonly<Record<string, VerificationResult>>>(EMPTY_VERIFICATION);
  const [verificationProviders, setVerificationProviders] = useState(EMPTY_PROVIDERS);
  const pendingChecks = verificationProviders.length - Object.keys(verification).length;
  const refreshVerification = (): void => {
    setVerification(EMPTY_VERIFICATION);
    setVerificationProviders([...api.providerRegistry.listByOrigin("byok")]);
  };

  useEffect(() => {
    let cancelled = false;

    for (const provider of verificationProviders) {
      void api.providerRegistry
        .verify(provider.providerId)
        .catch(
          (): VerificationResult => ({
            ok: false,
            message: t("Could not verify this provider. Reopen this tab to retry."),
            checkedAt: Date.now(),
          })
        )
        .then((result) => {
          if (cancelled) return;
          setVerification((results) => ({ ...results, [provider.providerId]: result }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [api, verificationProviders]);

  useEffect(() => {
    let cancelled = false;
    const sync = (): void => {
      if (!cancelled) setCatalogProviders(api.catalogService.getAllProviders());
    };
    const unsub = api.catalogService.onChange(sync);
    api.catalogService
      .ensureLoaded()
      .then(() => {
        if (cancelled) return;
        sync();
      })
      .catch((err) => {
        logError("[ModelsAndProvidersPanel] catalog ensureLoaded failed", err);
      });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [api]);

  const groups = useMemo<ProviderModelGroup[]>(() => {
    const byProvider = new Map<string, ConfiguredModel[]>();
    for (const model of configuredModels) {
      const list = byProvider.get(model.providerId);
      if (list) list.push(model);
      else byProvider.set(model.providerId, [model]);
    }
    const q = query.trim().toLowerCase();
    return providers
      .map((provider) => {
        const result =
          verification[provider.providerId] ??
          (verificationProviders.some((pending) => pending.providerId === provider.providerId)
            ? undefined
            : UNVERIFIED);
        const all = byProvider.get(provider.providerId) ?? (EMPTY_MODELS as ConfiguredModel[]);
        if (!q || provider.displayName.toLowerCase().includes(q)) {
          return {
            provider,
            models: all,
            verification: result,
          };
        }
        const models = all.filter(
          (m) => m.info.displayName.toLowerCase().includes(q) || m.info.id.toLowerCase().includes(q)
        );
        return {
          provider,
          models,
          verification: result,
        };
      })
      .filter((g) => !q || g.models.length > 0 || g.provider.displayName.toLowerCase().includes(q));
  }, [providers, configuredModels, query, verification, verificationProviders]);

  const handleAddProvider = (): void => {
    new AddProviderModal(app, {
      catalogProviders,
      localTemplates: LOCAL_PROVIDER_DEFINITIONS,
      customTemplate: CUSTOM_OPENAI_DEFINITION,
      onPick: (source) =>
        new ConfigureProviderModal(app, {
          state: { mode: "new", source },
          api,
          onSaved: refreshVerification,
        }).open(),
    }).open();
  };

  const handleRemove = (providerId: string): void => {
    const provider = providers.find((p) => p.providerId === providerId);
    if (!provider) return;
    const modal = new ConfirmModal(
      app,
      async () => {
        try {
          await api.coordinator.removeProvider(providerId);
        } catch (err) {
          logError("[ModelsAndProvidersPanel] removeProvider failed", err);
          new Notice(t("Failed to remove provider."));
        }
      },
      t("Remove {displayName}? This also removes all of its models from every model picker.", {
        displayName: provider.displayName,
      }),
      t("Remove provider"),
      t("Remove"),
      t("Cancel")
    );
    modal.open();
  };

  return (
    <div className="tw-relative tw-flex tw-flex-col tw-gap-4 tw-py-4">
      <ProviderVerificationProgress pending={pendingChecks} />
      <div className="tw-flex tw-items-start tw-justify-between tw-gap-4">
        <div className="tw-flex tw-flex-col tw-gap-1">
          <div className="tw-text-base tw-font-semibold tw-text-normal">
            {t("Models and providers")}
          </div>
          <div className="tw-max-w-xl tw-text-ui-smaller tw-leading-relaxed tw-text-muted">
            {t("Set up your own providers and models to use in Scribe.")}
          </div>
        </div>
        <Button className="tw-shrink-0" onClick={handleAddProvider}>
          <Plus className="tw-size-4" />
          {t("Add a provider")}
        </Button>
      </div>

      <SearchBar value={query} onChange={setQuery} placeholder={t("Search providers…")} />

      <div className="tw-flex tw-flex-col">
        <ProviderModelTable
          groups={groups}
          emptyMessage={
            query.trim() && providers.length > 0 ? t("No providers match your search.") : undefined
          }
          onConfigure={(id) =>
            new ConfigureProviderModal(app, {
              state: { mode: "edit", providerId: id },
              api,
              onSaved: refreshVerification,
            }).open()
          }
          onRemove={handleRemove}
        />
      </div>
    </div>
  );
};
