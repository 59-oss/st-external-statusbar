export const SOURCE_PRESET = '预设';
export const SOURCE_WORLDBOOK = '世界书';

const textOf = (value) => String(value ?? '').trim();

export function addImportCandidate(candidates, group, source, scope, name, content) {
  const clean = textOf(content);
  if (!clean) return;
  const cleanName = textOf(name) || '未命名条目';
  const key = `${group}::${source}::${scope}::${cleanName}::${clean.slice(0, 200)}`;
  if (!candidates.some((item) => item.key === key)) {
    candidates.push({ key, group, source, scope, name: cleanName, content: clean });
  }
}

export function getPresetEntriesSafe(targetWindow, name) {
  const preset = targetWindow?.TavernHelper?.getPreset?.(name);
  return preset && Array.isArray(preset.prompts) ? preset.prompts : [];
}

export function getPresetNamesSafe(targetWindow, context) {
  const names = targetWindow?.TavernHelper?.getPresetNames?.() || [];
  if (Array.isArray(names) && names.length) return names.filter(Boolean);
  const fallback = context?.getPresetManager?.('sysprompt')?.getSelectedPresetName?.();
  return fallback ? [fallback] : [];
}

export function getWorldbookNamesSafe(targetWindow, context, selectedWorldNames = []) {
  let all = [];
  try {
    if (targetWindow?.TavernHelper?.getWorldbookNames) all = targetWindow.TavernHelper.getWorldbookNames() || [];
    else if (Array.isArray(targetWindow?.world_names)) all = targetWindow.world_names;
  } catch (_) {}
  let globalNames = [];
  let charNames = [];
  let chatName = '';
  try { globalNames = targetWindow?.TavernHelper?.getGlobalWorldbookNames?.() || []; } catch (_) {}
  try {
    const charBooks = targetWindow?.TavernHelper?.getCharWorldbookNames?.('current') || {};
    charNames = [charBooks.primary, ...(charBooks.additional || [])].filter(Boolean);
  } catch (_) {}
  try { chatName = targetWindow?.TavernHelper?.getChatWorldbookName?.('current') || ''; } catch (_) {}
  const selected = Array.isArray(selectedWorldNames) ? selectedWorldNames : [selectedWorldNames];
  const contextNames = typeof context?.getWorldInfoNames === 'function' ? context.getWorldInfoNames() : [];
  return [...new Set([...charNames, chatName, ...globalNames, ...selected, ...contextNames, ...all].filter(Boolean))];
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

export async function collectComponentImportCandidates({ targetWindow, context, selectedWorldNames = [] }) {
  const candidates = [];
  for (const presetName of getPresetNamesSafe(targetWindow, context)) {
    for (const prompt of getPresetEntriesSafe(targetWindow, presetName)) {
      addImportCandidate(candidates, `预设：${presetName}`, presetName, SOURCE_PRESET, prompt?.name || prompt?.identifier || prompt?.id, prompt?.content);
    }
  }
  for (const worldName of getWorldbookNamesSafe(targetWindow, context, selectedWorldNames)) {
    const entries = await getWbEntriesSafe(targetWindow, worldName);
    for (const entry of entries) {
      addImportCandidate(candidates, `世界书：${worldName}`, worldName, SOURCE_WORLDBOOK, getWorldbookEntryName(entry), entry?.content);
    }
  }
  return candidates;
}
