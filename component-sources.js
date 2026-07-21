export const SOURCE_PRESET = '预设';
export const SOURCE_WORLDBOOK = '世界书';
export const COMPONENT_SCOPE_GLOBAL = '全局';
export const COMPONENT_SCOPE_PRESET = '预设';
export const COMPONENT_SCOPE_CHARACTER = '角色';

const textOf = (value) => String(value ?? '').trim();

export function addImportCandidate(candidates, group, source, scope, name, content, enabled = true, metadata = {}) {
  const clean = textOf(content);
  if (!clean) return;
  const cleanName = textOf(name) || '未命名条目';
  const key = `${group}::${source}::${scope}::${cleanName}::${clean.slice(0, 200)}`;
  if (!candidates.some((item) => item.key === key)) {
    candidates.push({ key, group, source, scope, name: cleanName, content: clean, enabled: enabled !== false, ...metadata });
  }
}

export function getPresetEntriesSafe(targetWindow, name) {
  const preset = targetWindow?.TavernHelper?.getPreset?.(name);
  return preset && Array.isArray(preset.prompts) ? preset.prompts : [];
}

export function getPresetPromptEnabledMap(targetWindow, name) {
  const preset = targetWindow?.TavernHelper?.getPreset?.(name);
  const lists = Array.isArray(preset?.prompt_order) ? preset.prompt_order : [];
  const order = lists.find((list) => Array.isArray(list?.order))?.order || [];
  return new Map(order.map((entry) => [textOf(entry?.identifier), entry?.enabled !== false]).filter(([identifier]) => Boolean(identifier)));
}

export function isPresetPromptEnabled(prompt, enabledMap) {
  const identifiers = [prompt?.identifier, prompt?.id, prompt?.name].map(textOf).filter(Boolean);
  for (const identifier of identifiers) {
    if (enabledMap.has(identifier)) return enabledMap.get(identifier);
  }
  return prompt?.enabled !== false;
}

export function getCurrentPresetNameSafe(targetWindow, context) {
  const candidates = [
    targetWindow?.TavernHelper?.getCurrentPresetName?.(),
    targetWindow?.TavernHelper?.getSelectedPresetName?.(),
    targetWindow?.getPresetManager?.()?.getSelectedPresetName?.(),
    context?.getPresetManager?.()?.getSelectedPresetName?.(),
    context?.presetName,
  ];
  const selectedFromDom = targetWindow?.document?.querySelector?.('select[data-preset-manager-for] option:checked')?.textContent;
  candidates.push(selectedFromDom);
  return candidates.map(textOf).find(Boolean) || '';
}

export function getPresetNamesSafe(targetWindow, context) {
  const names = targetWindow?.TavernHelper?.getPresetNames?.() || [];
  if (Array.isArray(names) && names.length) return [...new Set(names.map(textOf).filter(Boolean))];
  const current = getCurrentPresetNameSafe(targetWindow, context);
  return current ? [current] : [];
}

export function getCurrentCharacterNameSafe(context) {
  const characterId = Number.isInteger(context?.characterId) ? context.characterId : context?.this_chid;
  const character = context?.characters?.[characterId];
  return textOf(character?.name || character?.data?.name || context?.name1 || context?.characterName);
}

export function normalizeComponentScope(scope) {
  const clean = textOf(scope);
  if (clean === COMPONENT_SCOPE_PRESET) return COMPONENT_SCOPE_PRESET;
  if (clean === COMPONENT_SCOPE_CHARACTER || clean === '角色卡') return COMPONENT_SCOPE_CHARACTER;
  return COMPONENT_SCOPE_GLOBAL;
}

export function getComponentBindingName(scope, targetWindow, context, fallback = '') {
  const normalized = normalizeComponentScope(scope);
  if (normalized === COMPONENT_SCOPE_PRESET) return getCurrentPresetNameSafe(targetWindow, context) || textOf(fallback);
  if (normalized === COMPONENT_SCOPE_CHARACTER) return getCurrentCharacterNameSafe(context) || textOf(fallback);
  return '';
}

export function normalizeComponent(component, targetWindow, context) {
  const scope = normalizeComponentScope(component?.scope);
  return {
    ...component,
    scope,
    bindName: component?.bindName || getComponentBindingName(scope, targetWindow, context, component?.source),
  };
}

export function componentMatchesContext(component, targetWindow, context) {
  const item = normalizeComponent(component, targetWindow, context);
  if (item.enabled === false) return false;
  if (item.scope === COMPONENT_SCOPE_GLOBAL) return true;
  if (item.scope === COMPONENT_SCOPE_PRESET) return textOf(item.bindName) === getCurrentPresetNameSafe(targetWindow, context);
  if (item.scope === COMPONENT_SCOPE_CHARACTER) return textOf(item.bindName) === getCurrentCharacterNameSafe(context);
  return false;
}

export function getActiveComponentsForContext(components, targetWindow, context) {
  return (Array.isArray(components) ? components : [])
    .map((item, originalIndex) => ({ item, originalIndex }))
    .filter(({ item }) => componentMatchesContext(item, targetWindow, context))
    .sort((left, right) => {
      const leftOrder = Number(left.item?.sourceOrder);
      const rightOrder = Number(right.item?.sourceOrder);
      const leftWorldbook = left.item?.sourceType === SOURCE_WORLDBOOK && Number.isFinite(leftOrder);
      const rightWorldbook = right.item?.sourceType === SOURCE_WORLDBOOK && Number.isFinite(rightOrder);
      if (leftWorldbook && rightWorldbook) {
        const sourceCompare = textOf(left.item.source).localeCompare(textOf(right.item.source));
        if (sourceCompare) return sourceCompare;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      }
      if (leftWorldbook !== rightWorldbook) return leftWorldbook ? -1 : 1;
      return left.originalIndex - right.originalIndex;
    })
    .map(({ item }) => item);
}

export function getComponentFolderName(component) {
  const explicit = textOf(component?.folderName);
  if (explicit) return explicit;
  const source = textOf(component?.source);
  if (component?.sourceType === SOURCE_PRESET && source) return `预设：${source}`;
  if (component?.sourceType === SOURCE_WORLDBOOK && source) return `世界书：${source}`;
  return '手动添加';
}

function compareComponentLibraryItems(left, right) {
  const leftOrder = Number(left.sourceOrder);
  const rightOrder = Number(right.sourceOrder);
  const leftOrdered = Number.isFinite(leftOrder);
  const rightOrdered = Number.isFinite(rightOrder);
  if (leftOrdered && rightOrdered && leftOrder !== rightOrder) return leftOrder - rightOrder;
  if (leftOrdered !== rightOrdered) return leftOrdered ? -1 : 1;
  return left.index - right.index;
}

function getFolderSortRank(folder) {
  const first = folder.items[0] || {};
  if (first.sourceType === SOURCE_PRESET) return 1;
  if (first.sourceType === SOURCE_WORLDBOOK) return 2;
  return 0;
}

export function getComponentLibraryFolders(components, scope) {
  const normalizedScope = normalizeComponentScope(scope);
  const folders = new Map();
  (Array.isArray(components) ? components : [])
    .map((item, index) => ({ ...item, index, scope: normalizeComponentScope(item?.scope) }))
    .filter((item) => item.scope === normalizedScope)
    .forEach((item) => {
      const folderName = getComponentFolderName(item);
      if (!folders.has(folderName)) folders.set(folderName, { name: folderName, firstIndex: item.index, items: [] });
      folders.get(folderName).items.push(item);
    });
  return [...folders.values()]
    .map((folder) => ({ ...folder, items: folder.items.sort(compareComponentLibraryItems) }))
    .sort((left, right) => {
      const rankDiff = getFolderSortRank(left) - getFolderSortRank(right);
      if (rankDiff) return rankDiff;
      return left.firstIndex - right.firstIndex;
    });
}

export function getWorldbookNamesSafe(targetWindow, context, selectedWorldNames = []) {
  return getWorldbookGroupsSafe(targetWindow, context, selectedWorldNames).map((item) => item.name);
}

export function getWorldbookGroupsSafe(targetWindow, context, selectedWorldNames = []) {
  let globalNames = [];
  let charNames = [];
  let chatName = '';
  let allNames = [];
  try { globalNames = targetWindow?.TavernHelper?.getGlobalWorldbookNames?.() || []; } catch (_) {}
  try {
    const charBooks = targetWindow?.TavernHelper?.getCharWorldbookNames?.('current') || {};
    charNames = [charBooks.primary, ...(charBooks.additional || [])].filter(Boolean);
  } catch (_) {}
  try { chatName = targetWindow?.TavernHelper?.getChatWorldbookName?.('current') || ''; } catch (_) {}
  try {
    if (targetWindow?.TavernHelper?.getWorldbookNames) allNames = targetWindow.TavernHelper.getWorldbookNames() || [];
    else if (Array.isArray(targetWindow?.world_names)) allNames = targetWindow.world_names;
  } catch (_) {}
  const allNameSet = new Set(allNames.map(textOf).filter(Boolean));
  const selected = (Array.isArray(selectedWorldNames) ? selectedWorldNames : [selectedWorldNames])
    .map(textOf)
    .filter(Boolean)
    .filter((name) => !allNameSet.size || allNameSet.has(name));
  const groups = [];
  const seen = new Set();
  const add = (name, category, categoryLabel) => {
    const clean = textOf(name);
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    groups.push({ name: clean, category, categoryLabel });
  };
  [...globalNames, ...selected].forEach((name) => add(name, 'global', '全局世界书'));
  charNames.forEach((name) => add(name, 'character', '角色世界书'));
  add(chatName, 'chat', '聊天世界书');
  allNames.forEach((name) => add(name, 'inactive', '未启用世界书'));
  return groups;
}

export async function getWbEntriesSafe(targetWindow, name) {
  try {
    if (typeof targetWindow?.SillyTavern?.loadWorldInfo === 'function') {
      const wb = await targetWindow.SillyTavern.loadWorldInfo(name);
      if (wb) {
        const entries = wb.entries || wb;
        return Array.isArray(entries) ? entries : Object.values(entries);
      }
    }
  } catch (_) {}
  try {
    if (typeof targetWindow?.TavernHelper?.getWorldbook === 'function') {
      const wb = await targetWindow.TavernHelper.getWorldbook(name);
      if (wb) return Array.isArray(wb) ? wb : Object.values(wb);
    }
  } catch (_) {}
  try {
    if (typeof targetWindow?.getWorldbook === 'function') {
      const wb = await targetWindow.getWorldbook(name);
      if (wb) return Array.isArray(wb) ? wb : Object.values(wb);
    }
  } catch (_) {}
  try {
    const csrf = targetWindow?.document?.querySelector?.('meta[name="csrf-token"]')?.getAttribute('content') || targetWindow?.token || '';
    const res = await targetWindow.fetch('/api/worldinfo/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.entries) return Object.values(data.entries);
      if (data[name]?.entries) return Object.values(data[name].entries);
      return Array.isArray(data) ? data : Object.values(data);
    }
  } catch (_) {}
  return [];
}

export function getWorldbookEntryName(entry) {
  return textOf(entry?.name) || textOf(entry?.comment) || (Array.isArray(entry?.key) ? entry.key.join(', ') : textOf(entry?.key)) || `条目 ${entry?.uid ?? ''}`;
}

export function isWorldbookEntryEnabled(entry) {
  if (typeof entry?.enabled === 'boolean') return entry.enabled;
  return entry?.disable !== true;
}

export async function collectComponentImportCandidates({ targetWindow, context, selectedWorldNames = [] }) {
  const candidates = [];
  for (const presetName of getPresetNamesSafe(targetWindow, context)) {
    const enabledMap = getPresetPromptEnabledMap(targetWindow, presetName);
    getPresetEntriesSafe(targetWindow, presetName).forEach((prompt, sourceOrder) => {
      addImportCandidate(candidates, `预设：${presetName}`, presetName, SOURCE_PRESET, prompt?.name || prompt?.identifier || prompt?.id, prompt?.content, isPresetPromptEnabled(prompt, enabledMap), { sourceOrder, sourceUid: prompt?.identifier || prompt?.id });
    });
  }
  for (const worldName of getWorldbookNamesSafe(targetWindow, context, selectedWorldNames)) {
    const entries = await getWbEntriesSafe(targetWindow, worldName);
    entries.forEach((entry, sourceOrder) => {
      addImportCandidate(candidates, `世界书：${worldName}`, worldName, SOURCE_WORLDBOOK, getWorldbookEntryName(entry), entry?.content, isWorldbookEntryEnabled(entry), { sourceOrder, sourceUid: entry?.uid });
    });
  }
  return candidates;
}

export function collectPresetImportGroups({ targetWindow, context, presetName = '' }) {
  const selected = textOf(presetName) || getCurrentPresetNameSafe(targetWindow, context) || getPresetNamesSafe(targetWindow, context)[0] || '';
  if (!selected) return [];
  const candidates = [];
  const enabledMap = getPresetPromptEnabledMap(targetWindow, selected);
  getPresetEntriesSafe(targetWindow, selected).forEach((prompt, sourceOrder) => {
    addImportCandidate(candidates, `预设：${selected}`, selected, SOURCE_PRESET, prompt?.name || prompt?.identifier || prompt?.id, prompt?.content, isPresetPromptEnabled(prompt, enabledMap), { sourceOrder, sourceUid: prompt?.identifier || prompt?.id });
  });
  return [{ scope: SOURCE_PRESET, group: `预设：${selected}`, source: selected, loaded: true, items: candidates }];
}

export function collectWorldbookImportGroups({ targetWindow, context, selectedWorldNames = [] }) {
  return getWorldbookGroupsSafe(targetWindow, context, selectedWorldNames).map((worldbook) => ({
    scope: SOURCE_WORLDBOOK,
    group: worldbook.name,
    source: worldbook.name,
    category: worldbook.category,
    categoryLabel: worldbook.categoryLabel,
    loaded: false,
    loading: false,
    items: [],
  }));
}

export async function collectWorldbookImportCandidates(targetWindow, worldName) {
  const candidates = [];
  const entries = await getWbEntriesSafe(targetWindow, worldName);
  entries.forEach((entry, sourceOrder) => {
    addImportCandidate(candidates, `世界书：${worldName}`, worldName, SOURCE_WORLDBOOK, getWorldbookEntryName(entry), entry?.content, isWorldbookEntryEnabled(entry), { sourceOrder, sourceUid: entry?.uid });
  });
  return candidates;
}
