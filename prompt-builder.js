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

function getUserName(context) {
  return textOf(context?.name1 || context?.userName || 'User');
}

function getCurrentPreset(targetWindow, context) {
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
    const prompt = promptMap.get(id);
    if (id) used.add(id);
    if (!prompt || orderItem?.enabled === false) continue;
    ordered.push(prompt);
  }
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
      if (worldbookInserted) continue;
      worldbookInserted = true;
      for (const worldbookItem of worldbookItems) {
        const content = textOf(applySubstituteParams(worldbookItem?.content, substituteParams));
        if (content) messages.push({ role: normalizeRole(worldbookItem?.role), content });
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
    const markerType = prompt?.marker ? identifier : '';
    return {
      scope: '预设',
      role: prompt?.role,
      markerType,
      content: markerType ? '' : applySubstituteParams(replaceMacros(prompt?.content, { context, latestMessage }), substituteParams),
    };
  });
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

export function buildExternalStatusbarMessages({ targetWindow, context, latestMessage, taskPrompt, components, promptSourceItems, substituteParams }) {
  const hasSelectedPromptSources = Array.isArray(promptSourceItems) && promptSourceItems.length > 0;
  const preset = hasSelectedPromptSources ? null : getCurrentPreset(targetWindow, context);
  const activePromptSourceItems = hasSelectedPromptSources
    ? promptSourceItems
    : buildPresetPromptSourceItems(preset, { context, latestMessage, substituteParams });
  const promptMessages = buildPromptSourceMessages(activePromptSourceItems, { context, substituteParams });
  const hasChatHistoryMarker = activePromptSourceItems.some((item) => textOf(item?.markerType) === 'chatHistory');
  const fallback = promptMessages.length || activePromptSourceItems.length ? [] : [{
    role: 'system',
    content: '你是 SillyTavern 的外置文末状态栏生成器。你只生成文末状态栏/文末组件，不续写正文。',
  }];
  return [
    ...fallback,
    ...promptMessages,
    ...(!hasSelectedPromptSources && !hasChatHistoryMarker ? getRecentChatMessages(context?.chat) : []),
    { role: 'user', content: buildPluginTaskMessage({ taskPrompt, components, substituteParams }) },
  ];
}
