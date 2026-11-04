import { t } from "@/lib/i18n";
import { isChatModelInfo } from "@/modelManagement/chatModel/modelCapabilityFlags";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { ReactModal } from "@/components/modals/ReactModal";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useApp } from "@/context";
import { logError } from "@/logger";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import { BYOK_DEFAULT_AUTO_ENROLL } from "@/modelManagement/setup/ByokSetupApi";
import { providerRequiresApiKey } from "@/modelManagement/providers/providerRequiresApiKey";
import { byokProvidersAtom, configuredModelsAtom } from "@/modelManagement/state/atoms";
import type { ModelInfo, ProviderType } from "@/modelManagement/types/catalog";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import type { ProviderDefinition, VerificationResult } from "@/modelManagement/types/runtime";
import { CorsCompatibilitySetting } from "@/modelManagement/ui/components/CorsCompatibilitySetting";
import { ModelChecklist } from "@/modelManagement/ui/components/ModelChecklist";
import {
  ModelManagementProvider,
  useModelManagement,
} from "@/modelManagement/ui/ModelManagementContext";
import { settingsStore } from "@/settings/model";
import { useAtomValue } from "jotai";
import { Loader2 } from "lucide-react";
import { App, Notice } from "obsidian";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useModelCandidatePool } from "./useModelCandidatePool";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";
import { testProviderConnection } from "@/LLMProviders/testProviderConnection";
import {
  expandProviderUrl,
  getProviderConnectionProfile,
} from "@/modelManagement/providers/providerProfiles";
import {
  ProviderChatConnectionTest,
  ProviderParameterFields,
} from "@/modelManagement/ui/components/ProviderConnectionFields";

const EMPTY_METADATA: Record<string, ModelInfo> = Object.freeze({});
const EMPTY_MODELS: readonly ConfiguredModel[] = Object.freeze([]);

export type ConfigureState =
  | { mode: "new"; source: ProviderDefinition }
  | { mode: "edit"; providerId: string };

interface ConfigureProviderFormProps {
  state: ConfigureState;
  onClose: () => void;
  onSaved?: () => void;
}

export const ConfigureProviderForm: React.FC<ConfigureProviderFormProps> = ({
  state,
  onClose,
  onSaved,
}) => {
  const api = useModelManagement();
  const byokProviders = useAtomValue(byokProvidersAtom, { store: settingsStore });
  const configuredModels = useAtomValue(configuredModelsAtom, { store: settingsStore });

  const provider = useMemo<Provider | undefined>(
    () =>
      state.mode === "edit"
        ? byokProviders.find((p) => p.providerId === state.providerId)
        : undefined,
    [state, byokProviders]
  );

  const existingModels = useMemo(
    () =>
      state.mode === "edit"
        ? configuredModels.filter((m) => m.providerId === state.providerId)
        : EMPTY_MODELS,
    [state, configuredModels]
  );

  const keyProviderId = state.mode === "edit" ? state.providerId : null;
  const [initialApiKey, setInitialApiKey] = useState<string | null>(null);
  const [keyResolved, setKeyResolved] = useState(keyProviderId === null);
  useEffect(() => {
    if (keyProviderId === null) return;
    let cancelled = false;
    void api.providerRegistry
      .getApiKey(keyProviderId)
      .then((key) => {
        if (cancelled) return;
        setInitialApiKey(key);
        setKeyResolved(true);
      })
      .catch(() => {
        if (!cancelled) setKeyResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [keyProviderId, api]);

  if (state.mode === "edit" && (!provider || !keyResolved)) {
    return (
      <div className="tw-flex tw-h-full tw-items-center tw-justify-center">
        <Loader2 className="tw-size-5 tw-animate-spin tw-text-muted" />
      </div>
    );
  }

  return (
    <ConfigureProviderBody
      state={state}
      onClose={onClose}
      onSaved={onSaved}
      provider={provider}
      existingModels={existingModels}
      initialApiKey={initialApiKey}
    />
  );
};

interface ConfigureProviderBodyProps {
  state: ConfigureState;
  onClose: () => void;
  onSaved?: () => void;
  provider: Provider | undefined;
  existingModels: readonly ConfiguredModel[];
  initialApiKey: string | null;
}

const ConfigureProviderBody: React.FC<ConfigureProviderBodyProps> = ({
  state,
  onClose,
  onSaved,
  provider,
  existingModels,
  initialApiKey,
}) => {
  const api = useModelManagement();
  const app = useApp();

  const providerType: ProviderType | undefined =
    state.mode === "new" ? state.source.providerType : provider?.providerType;

  const catalogProviderId: string | undefined =
    state.mode === "new"
      ? state.source.catalogProviderId
      : provider?.origin.kind === "byok"
        ? provider.origin.catalogProviderId
        : undefined;

  const [catalogVersion, setCatalogVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const bump = (): void => {
      if (!cancelled) setCatalogVersion((v) => v + 1);
    };
    const unsub = api.catalogService.onChange(bump);
    api.catalogService
      .ensureLoaded()
      .then(bump)
      .catch((err) => logError("[ConfigureProviderDialog] catalog ensureLoaded failed", err));
    return () => {
      cancelled = true;
      unsub();
    };
  }, [api]);

  const catalogMetadata = useMemo<Record<string, ModelInfo>>(() => {
    if (!catalogProviderId) return EMPTY_METADATA;
    return api.catalogService.getProvider(catalogProviderId)?.models ?? EMPTY_METADATA;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- catalogVersion intentionally invalidates metadata read through catalogService
  }, [catalogProviderId, api, catalogVersion]);

  const [displayName, setDisplayName] = useState(() =>
    state.mode === "new" ? state.source.displayName : (provider?.displayName ?? "")
  );
  const [apiKey, setApiKey] = useState(() => initialApiKey ?? "");
  const [baseUrl, setBaseUrl] = useState(() =>
    state.mode === "edit" ? (provider?.baseUrl ?? "") : ""
  );
  const [enableCors, setEnableCors] = useState(() =>
    state.mode === "edit" ? (provider?.enableCors ?? true) : true
  );
  const [extras, setExtras] = useState<Record<string, unknown>>(() =>
    state.mode === "edit" ? (provider?.extras ?? {}) : {}
  );
  const [testModelId, setTestModelId] = useState("");
  const [chatCheck, setChatCheck] = useState<{
    key: string;
    testing: boolean;
    result: VerificationResult | null;
  } | null>(null);
  const chatRequest = useRef(0);
  const chatController = useRef<{ key: string; controller: AbortController } | null>(null);
  const [saving, setSaving] = useState(false);
  const [modelQuery, setModelQuery] = useState("");

  const requiresApiKey =
    state.mode === "new" ? state.source.requiresApiKey : providerRequiresApiKey(provider!);

  const currentCatalogProvider = catalogProviderId
    ? api.catalogService.getProvider(catalogProviderId)
    : undefined;
  const configuredNpm =
    typeof extras.npm === "string"
      ? extras.npm
      : state.mode === "new"
        ? state.source.npm
        : currentCatalogProvider?.npm;
  const profile = getProviderConnectionProfile(catalogProviderId, configuredNpm);

  const configurationExtras = (): Record<string, unknown> => {
    const catalog = catalogProviderId
      ? api.catalogService.getProvider(catalogProviderId)
      : undefined;
    const npm =
      typeof extras.npm === "string"
        ? extras.npm
        : ((state.mode === "new" ? state.source.npm : undefined) ?? catalog?.npm ?? profile.npm);
    const defaults = getProviderConnectionProfile(catalogProviderId, npm);
    const catalogBaseUrl =
      typeof extras.catalogBaseUrl === "string"
        ? extras.catalogBaseUrl
        : ((state.mode === "new" ? state.source.defaultBaseUrl : undefined) ??
          catalog?.defaultBaseUrl ??
          defaults.defaultBaseUrl);
    return {
      ...Object.fromEntries(
        defaults.parameters
          .filter((parameter) => parameter.defaultValue !== undefined)
          .map((parameter) => [parameter.key, parameter.defaultValue])
      ),
      ...extras,
      ...(npm ? { npm } : {}),
      ...(catalogBaseUrl ? { catalogBaseUrl } : {}),
    };
  };
  const connectionExtras = configurationExtras();
  const suggestedBaseUrl = profile.preferCompatibilityEndpoint ? profile.defaultBaseUrl : undefined;
  const defaultBaseUrl =
    suggestedBaseUrl ??
    (state.mode === "new" ? state.source.defaultBaseUrl : undefined) ??
    (typeof connectionExtras.catalogBaseUrl === "string"
      ? connectionExtras.catalogBaseUrl
      : undefined) ??
    profile.defaultBaseUrl ??
    "";
  const storedBaseUrl = baseUrl.trim() || defaultBaseUrl;
  const nativeApiSelected = profile.nativeApiSupported && extras.apiProtocol === "native";
  const missingRequiredBaseUrl =
    (nativeApiSelected && !baseUrl.trim()) ||
    (!storedBaseUrl &&
      (profile.requiresBaseUrl || (providerType === "openai-compatible" && !catalogProviderId)));
  let effectiveBaseUrl = "";
  let baseUrlError: string | null = null;
  try {
    if (storedBaseUrl) effectiveBaseUrl = expandProviderUrl(storedBaseUrl, connectionExtras);
  } catch (error) {
    baseUrlError =
      error instanceof TypeError
        ? t("Invalid provider URL.")
        : error instanceof Error
          ? error.message
          : String(error);
  }
  const missingParameters = profile.parameters.some((parameter) => {
    const value = connectionExtras[parameter.key];
    return parameter.required && (typeof value !== "string" || !value.trim());
  });
  const missingRequiredKey = requiresApiKey && !apiKey.trim();

  const pool = useModelCandidatePool({
    mode: state.mode,
    providerType,
    effectiveBaseUrl,
    existingModels,
    catalogMetadata,
    apiKey,
    extras: connectionExtras,
    requiresApiKey,
    autoDiscover: !!defaultBaseUrl,
    providerHydrated: !missingParameters && !baseUrlError && (state.mode !== "edit" || !!provider),
  });
  const testModels = pool.buildSelectedModelInfos().filter(isChatModelInfo);
  const activeTestModelId = testModels.some((model) => model.id === testModelId)
    ? testModelId
    : (testModels[0]?.id ?? "");
  const testModel = testModels.find((model) => model.id === activeTestModelId);
  const connectionKey = JSON.stringify([
    providerType,
    storedBaseUrl,
    apiKey,
    connectionExtras,
    enableCors,
    testModel,
  ]);
  const currentConnectionKey = useRef(connectionKey);
  if (currentConnectionKey.current !== connectionKey) {
    currentConnectionKey.current = connectionKey;
    chatRequest.current++;
  }
  const currentChatCheck = chatCheck?.key === connectionKey ? chatCheck : null;
  const invalidateChatCheck = (): void => {
    chatRequest.current++;
    chatController.current?.controller.abort();
    chatController.current = null;
    setChatCheck(null);
  };
  useEffect(
    () => () => {
      chatRequest.current++;
      chatController.current?.controller.abort();
    },
    []
  );

  const handleChatTest = async (): Promise<void> => {
    if (
      !providerType ||
      !testModel ||
      chatController.current?.key === connectionKey ||
      missingRequiredKey ||
      missingParameters ||
      missingRequiredBaseUrl ||
      baseUrlError
    )
      return;
    const request = ++chatRequest.current;
    const controller = new AbortController();
    chatController.current?.controller.abort();
    chatController.current = { key: connectionKey, controller };
    const snapshot: Provider = {
      ...(provider ?? {
        providerId: "test",
        origin: { kind: "byok", ...(catalogProviderId ? { catalogProviderId } : {}) },
        addedAt: Date.now(),
      }),
      providerType,
      displayName,
      baseUrl: storedBaseUrl || undefined,
      enableCors,
      requiresApiKey,
      extras: configurationExtras(),
    };
    setChatCheck({ key: connectionKey, testing: true, result: null });
    try {
      const result = await testProviderConnection({
        provider: snapshot,
        model: testModel,
        apiKey: apiKey || null,
        signal: controller.signal,
      });
      if (request === chatRequest.current && currentConnectionKey.current === connectionKey)
        setChatCheck({ key: connectionKey, testing: false, result });
    } catch (error) {
      if (request === chatRequest.current && currentConnectionKey.current === connectionKey)
        setChatCheck({
          key: connectionKey,
          testing: false,
          result: {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
            checkedAt: Date.now(),
          },
        });
    } finally {
      if (chatController.current?.controller === controller) chatController.current = null;
    }
  };

  const handleSaveNew = async (): Promise<void> => {
    if (state.mode !== "new" || !providerType) return;
    setSaving(true);
    try {
      await api.setup.byok.setupProvider({
        catalogProviderId: state.source.catalogProviderId,
        providerType,
        displayName,
        baseUrl: storedBaseUrl || undefined,
        enableCors,
        apiKey: apiKey || undefined,
        requiresApiKey: state.source.requiresApiKey,
        extras: configurationExtras(),
        models: pool.buildSelectedModelInfos(),
      });
      onSaved?.();
      onClose();
    } catch (err) {
      logError("[ConfigureProviderDialog] setupProvider failed", err);
      new Notice(t("Failed to save provider. Check the Scribe log for details."));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async (): Promise<void> => {
    if (state.mode !== "edit" || !provider) return;
    setSaving(true);
    try {
      await saveProviderEdit({
        providerId: state.providerId,
        apiKey,
        initialApiKey,
        displayName,
        effectiveBaseUrl: storedBaseUrl,
        enableCors,
        extras: configurationExtras(),
        existingModels,
        selectedWireIds: pool.selectedWireIds,
        selectedInfos: pool.buildSelectedModelInfos(),
        api,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      logError("[ConfigureProviderDialog] save changes failed", err);
      new Notice(t("Failed to save changes. Check the Scribe log for details."));
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = (): void => {
    setApiKey("");
    invalidateChatCheck();
  };

  const handleRemove = (): void => {
    if (state.mode !== "edit" || !provider) return;
    const modal = new ConfirmModal(
      app,
      async () => {
        try {
          await api.coordinator.removeProvider(state.providerId);
          onClose();
        } catch (err) {
          logError("[ConfigureProviderDialog] removeProvider failed", err);
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

  const headerName =
    state.mode === "new" ? state.source.displayName : (provider?.displayName ?? displayName);

  const canSave =
    pool.selectedWireIds.size > 0 &&
    !missingRequiredBaseUrl &&
    !missingRequiredKey &&
    !missingParameters &&
    !baseUrlError;
  const canTest =
    !missingRequiredBaseUrl && !missingRequiredKey && !missingParameters && !baseUrlError;

  const modelInputHint = state.mode === "new" ? state.source.modelInputHint : undefined;

  return (
    <div className="tw-group/settings tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-gap-4 tw-overflow-hidden">
      <div className="tw-flex tw-shrink-0 tw-flex-col tw-gap-1 tw-border-b tw-border-border tw-px-2 tw-pb-3">
        <div
          role="heading"
          aria-level={2}
          className="tw-text-base tw-font-semibold tw-leading-normal"
        >
          {t("Configure ")}
          {headerName}
        </div>
        <div className="tw-text-ui-smaller tw-leading-relaxed tw-text-muted">
          {t("Enter credentials and choose which models to enable.")}
        </div>
      </div>

      <div
        role="region"
        aria-label={t("Settings")}
        className="tw-min-h-0 tw-min-w-0 tw-flex-1 tw-overflow-y-auto tw-px-2 tw-py-1"
      >
        <fieldset
          disabled={saving}
          className="tw-m-0 tw-flex tw-min-w-0 tw-flex-col tw-gap-4 tw-border-0 tw-p-0"
        >
          <FormField label={t("Display name")}>
            <Input
              value={displayName}
              disabled={saving}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </FormField>
          <FormField label={t(profile.credentialLabel ?? "API key")} required={requiresApiKey}>
            <div className="tw-flex tw-gap-2">
              <PasswordInput
                className="tw-flex-1"
                value={apiKey}
                disabled={saving}
                onChange={(value) => {
                  invalidateChatCheck();
                  setApiKey(value);
                }}
                placeholder={
                  profile.credentialPlaceholder
                    ? t(profile.credentialPlaceholder)
                    : state.mode === "edit"
                      ? t("No API key set")
                      : t("Paste your API key")
                }
              />
              {state.mode === "edit" && apiKey.length > 0 && (
                <Button
                  variant="destructive"
                  onClick={handleClearKey}
                  data-testid="api-key-clear"
                  disabled={saving}
                >
                  {t("Clear")}
                </Button>
              )}
            </div>
            {missingRequiredKey && (
              <div className="tw-text-ui-smaller tw-leading-relaxed tw-text-muted">
                {t("An API key is required for this provider.")}
              </div>
            )}
          </FormField>
          <FormField label={t("Base URL")} required={profile.requiresBaseUrl || nativeApiSelected}>
            <Input
              value={baseUrl}
              disabled={saving}
              onChange={(event) => {
                invalidateChatCheck();
                setBaseUrl(event.target.value);
              }}
              placeholder={defaultBaseUrl}
            />
            {missingRequiredBaseUrl && (
              <p
                role="status"
                className="tw-m-0 tw-text-ui-smaller tw-leading-relaxed tw-text-muted"
              >
                {t("A base URL is required for this provider.")}
              </p>
            )}
            {baseUrlError && !missingParameters && (
              <p role="status" className="tw-m-0 tw-text-xs tw-text-error">
                {baseUrlError}
              </p>
            )}
          </FormField>
          <ProviderParameterFields
            parameters={profile.parameters}
            instructions={profile.instructions}
            apiFormat={
              profile.nativeApiSupported
                ? extras.apiProtocol === "native"
                  ? "native"
                  : "compatible"
                : undefined
            }
            onApiFormatChange={(apiProtocol) => {
              invalidateChatCheck();
              setExtras((previous) => ({ ...previous, apiProtocol }));
            }}
            values={connectionExtras}
            disabled={saving}
            onChange={(key, value) => {
              invalidateChatCheck();
              setExtras((previous) => ({ ...previous, [key]: value }));
            }}
          />
          <CorsCompatibilitySetting
            checked={enableCors}
            disabled={saving}
            onCheckedChange={(value) => {
              invalidateChatCheck();
              setEnableCors(value);
            }}
          />
          <div className="tw-flex tw-flex-col tw-gap-2">
            <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
              <div className="tw-text-sm tw-font-medium tw-text-normal">{t("Models")}</div>
              <Button
                variant="secondary"
                size="sm"
                disabled={saving || pool.fetching || !canTest || !effectiveBaseUrl}
                onClick={safeAsyncHandler(pool.fetchModels)}
              >
                {t("Fetch models")}
              </Button>
            </div>
            <p className="tw-m-0 tw-text-ui-smaller tw-leading-relaxed tw-text-muted">
              {t(
                "Fetching models only reads the directory; it does not test a chat or confirm access to every model."
              )}
            </p>
            <ModelChecklist
              availableModels={pool.availableModels}
              selected={pool.selectedWireIds}
              onToggle={(id, next) => {
                invalidateChatCheck();
                pool.toggle(id, next);
              }}
              onAddId={(id) => {
                invalidateChatCheck();
                pool.addId(id);
              }}
              onRemoveId={(id) => {
                invalidateChatCheck();
                pool.removeId(id);
              }}
              customIds={pool.customIds}
              query={modelQuery}
              onQueryChange={setModelQuery}
              modelInputHint={modelInputHint}
              fetching={pool.fetching}
              fetchError={pool.fetchError}
            />
          </div>
          <ProviderChatConnectionTest
            models={testModels}
            modelId={activeTestModelId}
            onModelChange={(id) => {
              invalidateChatCheck();
              setTestModelId(id);
            }}
            onTest={safeAsyncHandler(handleChatTest)}
            testing={currentChatCheck?.testing ?? false}
            result={currentChatCheck?.result ?? null}
            disabled={saving || !canTest}
          />
        </fieldset>
      </div>

      {state.mode === "new" ? (
        <div className="tw-flex tw-shrink-0 tw-flex-col-reverse tw-gap-2 tw-px-2 sm:tw-flex-row sm:tw-justify-end">
          <Button variant={"secondary"} onClick={onClose} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button
            variant={"default"}
            onClick={safeAsyncHandler(handleSaveNew)}
            disabled={!canSave || saving}
          >
            {saving ? <Loader2 className="tw-size-4 tw-animate-spin" /> : t("Save")}
          </Button>
        </div>
      ) : (
        <div className="tw-flex tw-shrink-0 tw-flex-col-reverse tw-gap-2 tw-px-2 sm:tw-flex-row sm:tw-justify-between">
          <Button variant={"destructive"} onClick={handleRemove} disabled={saving}>
            {t("Remove provider")}
          </Button>
          <div className="tw-flex tw-gap-2">
            <Button variant={"secondary"} onClick={onClose} disabled={saving}>
              {t("Cancel")}
            </Button>
            <Button
              variant={"default"}
              onClick={safeAsyncHandler(handleSaveEdit)}
              disabled={!canSave || saving}
            >
              {saving ? <Loader2 className="tw-size-4 tw-animate-spin" /> : t("Save")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

interface SaveEditArgs {
  providerId: string;
  apiKey: string;
  initialApiKey: string | null;
  displayName: string;
  effectiveBaseUrl: string;
  enableCors: boolean;
  extras: Record<string, unknown>;
  existingModels: readonly ConfiguredModel[];
  selectedWireIds: ReadonlySet<string>;
  selectedInfos: ModelInfo[];
  api: ModelManagementApi;
}

async function saveProviderEdit({
  providerId,
  apiKey,
  initialApiKey,
  displayName,
  effectiveBaseUrl,
  enableCors,
  extras,
  existingModels,
  selectedWireIds,
  selectedInfos,
  api,
}: SaveEditArgs): Promise<void> {
  if (apiKey !== (initialApiKey ?? "")) {
    if (apiKey.trim().length > 0) await api.providerRegistry.setApiKey(providerId, apiKey);
    else await api.providerRegistry.clearApiKey(providerId);
  }
  await api.providerRegistry.update(providerId, {
    displayName,
    baseUrl: effectiveBaseUrl || undefined,
    enableCors,
    extras: Object.keys(extras).length > 0 ? extras : undefined,
  });

  const deselectedIds = existingModels
    .filter((m) => !selectedWireIds.has(m.info.id))
    .map((m) => m.configuredModelId);
  const prevWireIds = new Set(existingModels.map((m) => m.info.id));
  const ids = await api.configuredModelRegistry.bulkSet(providerId, selectedInfos);
  if (deselectedIds.length > 0) {
    await api.backendConfigRegistry.removeRefs(deselectedIds);
  }

  for (let i = 0; i < selectedInfos.length; i++) {
    if (prevWireIds.has(selectedInfos[i].id)) continue;
    if (!isChatModelInfo(selectedInfos[i])) continue;
    for (const backend of BYOK_DEFAULT_AUTO_ENROLL) {
      await api.backendConfigRegistry.enableModel(backend, ids[i]);
    }
  }
}

interface ConfigureProviderModalOptions {
  state: ConfigureState;
  api: ModelManagementApi;
  onSaved?: () => void;
}

export class ConfigureProviderModal extends ReactModal {
  constructor(
    app: App,
    private readonly opts: ConfigureProviderModalOptions
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClasses(["tw-flex", "tw-max-h-[85vh]", "tw-flex-col"]);
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
      <ModelManagementProvider api={this.opts.api}>
        <ConfigureProviderForm
          state={this.opts.state}
          onClose={close}
          onSaved={this.opts.onSaved}
        />
      </ModelManagementProvider>
    );
  }
}
