import { createCatalogCommandDiscoveryStore, toLoaderDiscovery } from '@/core/providers/commands/catalogCommandDiscovery';
import { normalizeProviderCommandDiscoveryItems } from '@/core/providers/commands/ProviderCommandDiscoveryResult';
import { ClaudeCommandCatalog } from '@/providers/claude/commands/ClaudeCommandCatalog';
import { mapSDKCommands } from '@/providers/claude/commands/probeRuntimeCommands';
import { SlashCommandSource } from '@/shared/composer-dropdown/SlashCommandSource';

it.each(['marked', 'legacy'] as const)('preserves command ownership through the %s native picker snapshot', async provenance => {
  // Current SDK: builtin is true only for native rows; absent for user/project/plugin/MCP rows.
  const nativeMarker = provenance === 'marked' ? { builtin: true } : {};
  const commands = mapSDKCommands([
    { name: 'debug', description: 'My debugging workflow', argumentHint: '' },
    { name: 'init', description: 'My note initialization', argumentHint: '' },
    { name: 'cost', description: 'Native cost display', argumentHint: '', ...nativeMarker },
    { name: 'simplify', description: 'Shadowed custom workflow', argumentHint: '' },
    { name: 'simplify', description: 'Native workflow owns this name', argumentHint: '', ...nativeMarker },
    { name: 'new', description: 'Custom new workflow', argumentHint: '' },
  ], ['debug', 'init', 'simplify', 'new']);
  const catalog = new ClaudeCommandCatalog();
  const discovery = createCatalogCommandDiscoveryStore(catalog, async () => toLoaderDiscovery(normalizeProviderCommandDiscoveryItems(commands)));
  await discovery.load();
  const source = new SlashCommandSource({ providerConfig: catalog.getDropdownConfig(), providerDiscovery: discovery });
  try {
    const trigger = source.match('/', 1)!;
    const items = source.load(trigger, new AbortController().signal);
    expect(items.filter(item => item.id === 'sdk:debug' || item.id === 'sdk:init').map(item => ({
      id: item.id, label: item.label, detail: item.detail, replacement: item.kind === 'value' ? item.replacement : undefined,
    }))).toEqual(provenance === 'marked' ? [
      { id: 'sdk:debug', label: '/debug', detail: 'My debugging workflow', replacement: '/debug ' },
      { id: 'sdk:init', label: '/init', detail: 'My note initialization', replacement: '/init ' },
    ] : []);
    expect(items.filter(item => item.label === '/cost' || item.label === '/simplify')).toEqual([]);
    expect(items.filter(item => item.label === '/new')).toEqual([
      expect.objectContaining({ id: 'builtin:new' }),
    ]);
    expect(source.resolveCommandKind('/new', true)).toBe('command');
    expect(source.resolveCommandKind('/debug', true)).toBe(provenance === 'marked' ? 'skill' : null);
    const snapshot = discovery.getSnapshot();
    if (snapshot.status !== 'ready') throw new Error('Expected settled native command discovery');
    const debugEntry = snapshot.items.find(entry => entry.name === 'debug');
    expect(debugEntry && { source: debugEntry.source, isEditable: debugEntry.isEditable, isDeletable: debugEntry.isDeletable })
      .toEqual(provenance === 'marked' ? { source: 'sdk', isEditable: false, isDeletable: false } : undefined);
    const debug = items.find(item => item.id === 'sdk:debug');
    const selected = debug?.kind === 'value' ? source.select(debug, trigger) : undefined;
    expect(selected).toEqual(provenance === 'marked' ? { kind: 'replace', text: '/debug ' } : undefined);
  } finally {
    source.destroy();
  }
});
