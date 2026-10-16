import { ProviderModelCatalogController } from '../../../core/providers/models/ProviderModelCatalog';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type { OpencodeMetadataService } from '../metadata/OpencodeMetadataService';
import { buildOpencodeBaseModels, encodeOpencodeModelId, splitOpencodeModelLabel } from '../models';
import { getOpencodeProviderSettings, updateOpencodeProviderSettings } from '../settings';

export function createOpencodeModels(host: ProviderHost, native: Pick<OpencodeMetadataService, 'discoverModels' | 'warmModelsMetadata'>): ProviderModelCatalogController {
  return new ProviderModelCatalogController({
    providerId: 'opencode',
    host,
    update: updateOpencodeProviderSettings,
    providerName: 'OpenCode',
    read: (settings = host.settings) => {
      const current = getOpencodeProviderSettings(settings);
      return {
        enabled: current.enabled,
        models: buildOpencodeBaseModels(current.discoveredModels).map(model => {
          const { modelLabel, providerLabel } = splitOpencodeModelLabel(model.label || model.rawId);
          return {
            id: model.rawId,
            name: modelLabel,
            description: model.description,
            providerKey: model.rawId.split('/')[0],
            providerLabel,
          };
        }).reverse(),
        selectedIds: current.visibleModels,
        aliases: current.modelAliases,
      };
    },
    discover: signal => native.discoverModels(signal),
    async afterSelect(addedIds) {
      await native.warmModelsMetadata(addedIds.map(encodeOpencodeModelId));
    },
  });
}
