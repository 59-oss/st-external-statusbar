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
  const characterId = Number.isInteger(context?.characterId) ? context.characterId : context?.this_chid;
  const character = context?.characters?.[characterId];
  return textOf(context?.name2 || context?.characterName || character?.name || character?.data?.name || '角色');
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

function getOrderedEnabledPrompts(preset) {
  const prompts = Array.isArray(preset?.prompts) ? preset.prompts : [];
  const promptMap = new Map(prompts.map((prompt) => [getPromptIdentifier(prompt), prompt]).filter(([id]) => Boolean(id)));
  const orderList = (Array.isArray(preset?.prompt_order) ? preset.prompt_order : [])
    .find((item) => Array.isArray(item?.order))?.order || [];
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

function buildPromptSourceMessages(promptSourceItems, substituteParams) {
  return (Array.isArray(promptSourceItems) ? promptSourceItems : [])
    .map((item) => ({
      role: normalizeRole(item?.role),
      content: textOf(applySubstituteParams(item?.content, substituteParams)),
    }))
    .filter((message) => textOf(message.content));
}

function buildComponentText(components, substituteParams) {
  return components?.length
    ? components.map((item, index) => `【组件 ${index + 1}｜${item.scope || '全局'}｜${item.name || '未命名'}】\n${applySubstituteParams(item.content || '', substituteParams)}`).join('\n\n')
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
  const sourceMessages = buildPromptSourceMessages(promptSourceItems, substituteParams);
  const preset = sourceMessages.length ? null : getCurrentPreset(targetWindow, context);
  const presetMessages = sourceMessages.length ? sourceMessages : getOrderedEnabledPrompts(preset)
    .map((prompt) => ({
      role: normalizeRole(prompt?.role),
      content: applySubstituteParams(replaceMacros(prompt?.content, { context, latestMessage }), substituteParams),
    }))
    .filter((message) => textOf(message.content));
  const fallback = presetMessages.length ? [] : [{
    role: 'system',
    content: '你是 SillyTavern 的外置文末状态栏生成器。你只生成文末状态栏/文末组件，不续写正文。',
  }];
  return [
    ...fallback,
    ...presetMessages,
    ...getRecentChatMessages(context?.chat),
    { role: 'user', content: buildPluginTaskMessage({ taskPrompt, components, substituteParams }) },
  ];
}
