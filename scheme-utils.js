export const SCHEME_TYPES = ['api', 'task', 'preset', 'worldbook'];

const textOf = (value) => String(value ?? '').trim();
const clone = (value) => JSON.parse(JSON.stringify(value ?? {}));

export function normalizeSchemeList(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object' && textOf(item.name)) : [];
}

function groupKeys(groups, predicate) {
  const keys = new Set();
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!predicate(group)) continue;
    for (const item of Array.isArray(group.items) ? group.items : []) {
      if (item?.key) keys.add(item.key);
    }
  }
  return keys;
}

function pickByKeys(source, keys) {
  const result = {};
  const store = source && typeof source === 'object' ? source : {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(store, key)) result[key] = store[key];
  }
  return result;
}

export function captureSchemeSnapshot(type, settings, groups = [], options = {}) {
  const isWorldbookGroup = options.isWorldbookGroup || ((group) => group?.scope === 'worldbook');
  if (type === 'api') {
    return {
      apiUrl: settings.apiUrl || '',
      apiKey: settings.apiKey || '',
      apiModel: settings.apiModel || '',
      apiModelOptions: Array.isArray(settings.apiModelOptions) ? [...settings.apiModelOptions] : [],
      maxTokens: settings.maxTokens || '',
      temperature: settings.temperature || '',
      streamingEnabled: Boolean(settings.streamingEnabled),
    };
  }
  if (type === 'task') return { taskPrompt: settings.taskPrompt || '' };
  if (type === 'preset') {
    const keys = groupKeys(groups, (group) => !isWorldbookGroup(group));
    return {
      activeSourcePreset: settings.activeSourcePreset || '',
      taskPlacementEnabled: Boolean(settings.taskPlacementEnabled),
      taskPlacementAfterSourceId: settings.taskPlacementAfterSourceId || '',
      promptSelections: pickByKeys(settings.promptSelections, keys),
      sourceContentOverrides: pickByKeys(settings.sourceContentOverrides, keys),
    };
  }
  if (type === 'worldbook') {
    const worldbookGroups = (Array.isArray(groups) ? groups : []).filter(isWorldbookGroup);
    const keys = groupKeys(worldbookGroups, () => true);
    return {
      worldbookSources: [...new Set(worldbookGroups.map((group) => textOf(group.source)).filter(Boolean))],
      promptSelections: pickByKeys(settings.promptSelections, keys),
      sourceContentOverrides: pickByKeys(settings.sourceContentOverrides, keys),
    };
  }
  return {};
}

export function saveScheme(list, name, snapshot, id = '') {
  const cleanName = textOf(name);
  if (!cleanName) return normalizeSchemeList(list);
  const schemes = normalizeSchemeList(list).map((item) => ({ ...item, snapshot: clone(item.snapshot) }));
  const schemeId = textOf(id) || `scheme-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const next = { id: schemeId, name: cleanName, updatedAt: Date.now(), snapshot: clone(snapshot) };
  const index = schemes.findIndex((item) => item.id === schemeId);
  if (index >= 0) schemes[index] = next;
  else schemes.push(next);
  return schemes;
}

export function findScheme(list, id) {
  const schemeId = textOf(id);
  return normalizeSchemeList(list).find((item) => item.id === schemeId) || null;
}

export function deleteScheme(list, id) {
  const schemeId = textOf(id);
  return normalizeSchemeList(list).filter((item) => item.id !== schemeId);
}
