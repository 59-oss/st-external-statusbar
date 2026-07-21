const textOf = (value) => String(value ?? '').trim();

function getRecentChatText(chat, limit = 12) {
  return (Array.isArray(chat) ? chat : []).slice(-limit).map((item) => `${item?.is_user ? '用户' : '助手'}：${item?.mes || ''}`).join('\n\n');
}

function getRecentChatMessages(chat, limit = 12) {
  return (Array.isArray(chat) ? chat : [])
    .slice(-limit)
    .map((item) => ({
      role: item?.is_user ? 'user' : 'assistant',
      content: textOf(item?.mes),
    }))
    .filter((message) => textOf(message.content));
}

function getCharacterName(context) {
  const characterId = textOf(context?.characterId) || textOf(context?.this_chid);
  const character = context?.characters?.[characterId];
  return textOf(context?.name2 || context?.characterName || character?.name || character?.data?.name || '角色');
}

function getSelectedCharacter(context) {
  const characterId = textOf(context?.characterId) || textOf(context?.this_chid);
  return context?.characters?.[characterId] || {};
}

function getCharacterField(context, field) {
  const cardFields = getCharacterCardFieldsSafe(context);
  const fieldMap = {
    description: cardFields.description,
    personality: cardFields.personality,
    scenario: cardFields.scenario,
    mes_example: cardFields.mesExamples,
    persona: cardFields.persona,
  };
  if (textOf(fieldMap[field])) return textOf(fieldMap[field]);
  const character = getSelectedCharacter(context);
  return textOf(character?.[field] || character?.data?.[field]);
}

function getCharacterCardFieldsSafe(context) {
  if (typeof context?.getCharacterCardFields !== 'function') return {};
  try {
    return context.getCharacterCardFields({ chid: context?.characterId ?? context?.this_chid }) || {};
  } catch {
    try {
      return context.getCharacterCardFields() || {};
    } catch {
      return {};
    }
  }
}

function getRuntimeMarkerContent(markerType, context) {
  switch (textOf(markerType)) {
    case 'charDescription':
      return getCharacterField(context, 'description');
    case 'charPersonality':
      return getCharacterField(context, 'personality');
    case 'scenario':
      return getCharacterField(context, 'scenario');
    case 'dialogueExamples':
      return getCharacterField(context, 'mes_example');
    case 'personaDescription':
      return getCharacterField(context, 'persona') || textOf(context?.powerUserSettings?.persona_description || context?.power_user?.persona_description || context?.personaDescription);
    default:
      return '';
  }
}

export function createRuntimePromptDiagnostics({ context, promptSourceItems, runtimeInsertions } = {}) {
  const markerTypes = (Array.isArray(promptSourceItems) ? promptSourceItems : [])
    .map((item) => textOf(item?.markerType))
    .filter(Boolean);
  return {
    characterFields: {
      characterId: textOf(context?.characterId) || textOf(context?.this_chid),
      descriptionLength: getCharacterField(context, 'description').length,
      personalityLength: getCharacterField(context, 'personality').length,
      scenarioLength: getCharacterField(context, 'scenario').length,
      dialogueExamplesLength: getCharacterField(context, 'mes_example').length,
      personaLength: getCharacterField(context, 'persona').length,
    },
    selectedPromptMarkers: [...new Set(markerTypes)],
    runtimeInsertions: runtimeInsertions || null,
  };
}

function getUserName(context) {
  return textOf(context?.name1 || context?.userName || 'User');
}

function getCurrentPreset(targetWindow, context) {
  const candidates = [targetWindow, targetWindow?.parent, globalThis].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const preset = candidate?.getPreset?.('in_use');
      if (preset && Array.isArray(preset.prompts)) return preset;
    } catch {}
  }
  const helper = targetWindow?.TavernHelper;
  const presetName = textOf(helper?.getCurrentPresetName?.() || helper?.getSelectedPresetName?.() || context?.presetName);
  if (!presetName) return null;
  try {
    return helper?.getPreset?.(presetName) || null;
  } catch {
    return null;
  }
}

function getPromptIdentifier(prompt) {
  return textOf(prompt?.identifier || prompt?.id || prompt?.name);
}

const NATIVE_PRESET_MARKER_NAMES = new Map([
  ['world info (before)', 'worldInfoBefore'],
  ['world info (after)', 'worldInfoAfter'],
  ['char description', 'charDescription'],
  ['char personality', 'charPersonality'],
  ['scenario', 'scenario'],
  ['persona description', 'personaDescription'],
  ['chat examples', 'dialogueExamples'],
  ['chat history', 'chatHistory'],
]);

function getNativePresetMarkerType(value) {
  const identifier = typeof value === 'object' ? getPromptIdentifier(value) : textOf(value);
  if ([
    'worldInfoBefore',
    'worldInfoAfter',
    'charDescription',
    'charPersonality',
    'scenario',
    'personaDescription',
    'dialogueExamples',
    'chatHistory',
  ].includes(identifier)) return identifier;

  const name = typeof value === 'object' ? textOf(value?.name).toLowerCase() : '';
  return NATIVE_PRESET_MARKER_NAMES.get(name) || '';
}

function createNativePresetMarkerPrompt(identifier) {
  const clean = textOf(identifier);
  const markerType = getNativePresetMarkerType(clean);
  if (!markerType) return null;
  return {
    identifier: markerType,
    role: 'system',
    marker: true,
    content: '',
  };
}

function getActivePresetPromptOrder(preset) {
  const lists = Array.isArray(preset?.prompt_order) ? preset.prompt_order : [];
  const preferred = lists.find((list) => String(list?.character_id) === '100001' && Array.isArray(list?.order));
  return (preferred || lists.find((list) => Array.isArray(list?.order)))?.order || [];
}

function getOrderedEnabledPrompts(preset) {
  const prompts = Array.isArray(preset?.prompts) ? preset.prompts : [];
  const promptMap = new Map(prompts.map((prompt) => [getPromptIdentifier(prompt), prompt]).filter(([id]) => Boolean(id)));
  const orderList = getActivePresetPromptOrder(preset);
  const used = new Set();
  const ordered = [];
  for (const orderItem of orderList) {
    const id = textOf(orderItem?.identifier);
    const prompt = promptMap.get(id) || createNativePresetMarkerPrompt(id);
    if (id) used.add(id);
    if (!prompt || orderItem?.enabled === false) continue;
    ordered.push(prompt);
  }
  if (orderList.length) return ordered;
  for (const prompt of prompts) {
    const id = getPromptIdentifier(prompt);
    if (!id || used.has(id) || prompt?.enabled === false) continue;
    ordered.push(prompt);
  }
  return ordered;
}

function replaceMacros(content, { context, latestMessage }) {
  const chatHistory = getRecentChatText(context?.chat);
  const charName = getCharacterName(context);
  const userName = getUserName(context);
  const replacements = {
    '{{char}}': charName,
    '{{user}}': userName,
    '{{lastMessage}}': latestMessage?.mes || '',
    '{{lastAssistantMessage}}': latestMessage?.mes || '',
    '{{recentChat}}': chatHistory,
    '{{chatHistory}}': chatHistory,
    '{{description}}': context?.characters?.[context?.characterId ?? context?.this_chid]?.description || context?.characters?.[context?.characterId ?? context?.this_chid]?.data?.description || '',
    '{{scenario}}': context?.characters?.[context?.characterId ?? context?.this_chid]?.scenario || context?.characters?.[context?.characterId ?? context?.this_chid]?.data?.scenario || '',
    '{{personality}}': context?.characters?.[context?.characterId ?? context?.this_chid]?.personality || context?.characters?.[context?.characterId ?? context?.this_chid]?.data?.personality || '',
  };
  return Object.entries(replacements).reduce((text, [key, value]) => text.split(key).join(String(value ?? '')), String(content || ''));
}

function normalizeRole(role) {
  const clean = textOf(role).toLowerCase();
  if (['system', 'assistant', 'user'].includes(clean)) return clean;
  return 'system';
}

function applySubstituteParams(content, substituteParams) {
  const text = String(content || '');
  if (typeof substituteParams !== 'function') return text;
  try {
    return String(substituteParams(text) ?? '');
  } catch {
    return text;
  }
}

function getActiveWorldbookNames(targetWindow) {
  const names = [];
  const seen = new Set();
  const add = (name) => {
    const clean = textOf(name);
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    names.push(clean);
  };
  try {
    const globalNames = targetWindow?.TavernHelper?.getGlobalWorldbookNames?.() || [];
    (Array.isArray(globalNames) ? globalNames : [globalNames]).forEach(add);
  } catch {}
  try {
    const charBooks = targetWindow?.TavernHelper?.getCharWorldbookNames?.('current') || {};
    add(charBooks.primary);
    (Array.isArray(charBooks.additional) ? charBooks.additional : []).forEach(add);
  } catch {}
  try {
    add(targetWindow?.TavernHelper?.getChatWorldbookName?.('current'));
  } catch {}
  return names;
}

async function loadWorldbookEntries(targetWindow, name) {
  try {
    if (typeof targetWindow?.SillyTavern?.loadWorldInfo === 'function') {
      const book = await targetWindow.SillyTavern.loadWorldInfo(name);
      const entries = book?.entries || book;
      return Array.isArray(entries) ? entries : Object.values(entries || {});
    }
  } catch {}
  try {
    if (typeof targetWindow?.TavernHelper?.getWorldbook === 'function') {
      const book = await targetWindow.TavernHelper.getWorldbook(name);
      return Array.isArray(book) ? book : Object.values(book?.entries || book || {});
    }
  } catch {}
  return [];
}

function isWorldbookEntryEnabled(entry) {
  if (!entry) return false;
  if (typeof entry.enabled === 'boolean') return entry.enabled;
  return entry.disable !== true;
}

function getWorldbookInsertionBucket(entry) {
  const position = entry?.position;
  if (position === 0 || textOf(position) === 'before_char' || textOf(position) === 'before_character_definition') return 'before';
  if (position === 1 || textOf(position) === 'after_char' || textOf(position) === 'after_character_definition') return 'after';
  if (typeof position === 'object' && position) {
    const type = textOf(position.type);
    if (type === 'before_character_definition' || type === 'before_char') return 'before';
    if (type === 'after_character_definition' || type === 'after_char') return 'after';
    if (type === 'at_depth') return 'atDepth';
  }
  return 'after';
}

async function collectRuntimeWorldbookInserts(targetWindow, substituteParams) {
  const buckets = { before: [], after: [], atDepth: [] };
  for (const name of getActiveWorldbookNames(targetWindow)) {
    const entries = await loadWorldbookEntries(targetWindow, name);
    for (const entry of entries) {
      if (!isWorldbookEntryEnabled(entry)) continue;
      const content = textOf(applySubstituteParams(entry?.content, substituteParams));
      if (!content) continue;
      buckets[getWorldbookInsertionBucket(entry)].push(content);
    }
  }
  return buckets;
}

function replaceRuntimeMarkerMessages(messages, markerType, role, contents) {
  const insertMessages = contents.map(textOf).filter(Boolean).map((content) => ({ role, content }));
  let inserted = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.runtimeMarkerType !== markerType) continue;
    const replacements = inserted ? [] : insertMessages;
    messages.splice(index, 1, ...replacements);
    inserted += replacements.length;
  }
  return inserted;
}

async function applyRuntimeTemplateInsertions(messages, { targetWindow, context, substituteParams }) {
  const worldbooks = await collectRuntimeWorldbookInserts(targetWindow, substituteParams);
  const beforeWorldbook = worldbooks.before.join('\n\n');
  const afterWorldbook = [...worldbooks.after, ...worldbooks.atDepth].join('\n\n');
  const insertions = {
    charInfoLength: getCharacterField(context, 'description').length,
    userInfoLength: getRuntimeMarkerContent('personaDescription', context).length,
    worldbookBeforeCount: worldbooks.before.length,
    worldbookAfterCount: worldbooks.after.length,
    worldbookAtDepthCount: worldbooks.atDepth.length,
    insertedMessageCount: 0,
  };
  insertions.insertedMessageCount += replaceRuntimeMarkerMessages(messages, 'worldInfoBefore', 'system', [beforeWorldbook]);
  insertions.insertedMessageCount += replaceRuntimeMarkerMessages(messages, 'worldInfoAfter', 'system', [afterWorldbook]);
  return insertions;
}

function isWorldbookSourceItem(item) {
  return textOf(item?.scope) === '世界书';
}

function isWorldInfoMarker(markerType) {
  return ['worldInfoBefore', 'worldInfoAfter'].includes(textOf(markerType));
}

function buildPromptSourceMessages(promptSourceItems, { context, substituteParams }) {
  const items = Array.isArray(promptSourceItems) ? promptSourceItems : [];
  const worldbookItems = items.filter(isWorldbookSourceItem);
  const hasWorldInfoMarker = items.some((item) => isWorldInfoMarker(item?.markerType));
  let worldbookInserted = false;
  const messages = [];

  for (const item of items) {
    const markerType = textOf(item?.markerType);
    if (isWorldbookSourceItem(item) && hasWorldInfoMarker) continue;

    if (isWorldInfoMarker(markerType)) {
      if (item?.locked) {
        messages.push({ role: normalizeRole(item?.role), content: '', runtimeMarkerType: markerType });
        continue;
      }
      if (worldbookItems.length) {
        if (worldbookInserted) continue;
        worldbookInserted = true;
        for (const worldbookItem of worldbookItems) {
          const content = textOf(applySubstituteParams(worldbookItem?.content, substituteParams));
          if (content) messages.push({ role: normalizeRole(worldbookItem?.role), content });
        }
      } else {
        messages.push({ role: normalizeRole(item?.role), content: '', runtimeMarkerType: markerType });
      }
      continue;
    }

    if (markerType === 'chatHistory') {
      messages.push(...getRecentChatMessages(context?.chat));
      continue;
    }

    const runtimeMarkerContent = getRuntimeMarkerContent(markerType, context);
    const content = textOf(applySubstituteParams(runtimeMarkerContent || item?.content, substituteParams));
    if (content) messages.push({ role: normalizeRole(item?.role), content });
  }

  return messages;
}

function buildPresetPromptSourceItems(preset, { context, latestMessage, substituteParams }) {
  return getOrderedEnabledPrompts(preset).map((prompt) => {
    const identifier = getPromptIdentifier(prompt);
    const markerType = getNativePresetMarkerType(prompt);
    return {
      scope: '预设',
      sourceUid: identifier,
      identifier,
      name: prompt?.name || identifier,
      role: prompt?.role,
      markerType,
      locked: Boolean(markerType),
      content: markerType ? '' : applySubstituteParams(replaceMacros(prompt?.content, { context, latestMessage }), substituteParams),
    };
  });
}

function getPromptSourceItemId(item) {
  return textOf(item?.sourceUid || item?.identifier || item?.id || item?.name);
}

function mergeMissingPresetMarkers(promptSourceItems, preset, options) {
  const selectedItems = Array.isArray(promptSourceItems) ? promptSourceItems : [];
  if (!selectedItems.length || selectedItems.some((item) => textOf(item?.markerType))) return selectedItems;
  const presetItems = buildPresetPromptSourceItems(preset, options);
  if (!presetItems.some((item) => textOf(item?.markerType))) return selectedItems;

  const selectedById = new Map();
  selectedItems.forEach((item) => {
    const id = getPromptSourceItemId(item);
    if (id && !selectedById.has(id)) selectedById.set(id, item);
  });

  const used = new Set();
  const merged = [];
  presetItems.forEach((presetItem) => {
    if (textOf(presetItem?.markerType)) {
      merged.push(presetItem);
      return;
    }
    const selected = selectedById.get(getPromptSourceItemId(presetItem));
    if (selected) {
      used.add(selected);
      merged.push(selected);
    } else if (textOf(presetItem?.content)) {
      merged.push(presetItem);
    }
  });

  selectedItems.forEach((item) => {
    if (!used.has(item)) merged.push(item);
  });
  return merged;
}

function buildComponentText(components, substituteParams) {
  return components?.length
    ? components.map((item) => applySubstituteParams(item.content || '', substituteParams)).filter(textOf).join('\n\n')
    : '当前没有启用的组件。请根据生成任务指令输出状态栏。';
}

function buildPluginTaskMessage({ taskPrompt, components, substituteParams }) {
  return [
    '请不要续写正文。',
    '请基于上方预设、角色、世界观与已有正文，生成需要追加在正文末尾的文末组件。',
    '',
    `生成任务：${applySubstituteParams(taskPrompt, substituteParams)}`,
    '',
    '启用组件：',
    buildComponentText(components, substituteParams),
    '',
    '现在只输出文末组件内容，不解释，不输出分析过程。',
  ].join('\n');
}

export async function buildExternalStatusbarMessages({ targetWindow, context, latestMessage, taskPrompt, components, promptSourceItems, substituteParams }) {
  const hasSelectedPromptSources = Array.isArray(promptSourceItems) && promptSourceItems.length > 0;
  const preset = getCurrentPreset(targetWindow, context);
  const activePromptSourceItems = hasSelectedPromptSources
    ? mergeMissingPresetMarkers(promptSourceItems, preset, { context, latestMessage, substituteParams })
    : buildPresetPromptSourceItems(preset, { context, latestMessage, substituteParams });
  const promptMessages = buildPromptSourceMessages(activePromptSourceItems, { context, substituteParams });
  const hasChatHistoryMarker = activePromptSourceItems.some((item) => textOf(item?.markerType) === 'chatHistory');
  const fallback = promptMessages.length || activePromptSourceItems.length ? [] : [{
    role: 'system',
    content: '你是 SillyTavern 的外置文末状态栏生成器。你只生成文末状态栏/文末组件，不续写正文。',
  }];
  const messages = [
    ...fallback,
    ...promptMessages,
    ...(!hasSelectedPromptSources && !hasChatHistoryMarker ? getRecentChatMessages(context?.chat) : []),
    { role: 'user', content: buildPluginTaskMessage({ taskPrompt, components, substituteParams }) },
  ];
  messages.promptSourceItems = activePromptSourceItems;
  messages.runtimeInsertions = await applyRuntimeTemplateInsertions(messages, { targetWindow, context, substituteParams });
  return messages;
}
