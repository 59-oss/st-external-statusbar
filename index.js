import { getContext } from '../../../st-context.js';
import {
  COMPONENT_SCOPE_CHARACTER,
  COMPONENT_SCOPE_GLOBAL,
  COMPONENT_SCOPE_PRESET,
  SOURCE_WORLDBOOK,
  collectPresetImportGroups,
  collectWorldbookImportCandidates,
  collectWorldbookImportGroups,
  getActiveComponentsForContext,
  getComponentFolderName,
  getComponentLibraryFolders,
  getComponentBindingName,
  getCurrentPresetNameSafe,
  getPresetNamesSafe,
  normalizeComponent,
} from './component-sources.js?ver=0.3.57';
import { extractModelIds, normalizeChatCompletionsUrl, normalizeModelsUrl } from './api-utils.js?ver=0.3.57';
import { injectStatusbarText } from './inject-utils.js?ver=0.3.57';
import { buildExternalStatusbarMessages, createRuntimePromptDiagnostics } from './prompt-builder.js?ver=0.3.57';
import { createPromptLog } from './prompt-log.js?ver=0.3.57';
import { collectSelectedPromptSourceItems, syncPromptSelectionsFromGroups } from './source-selection.js?ver=0.3.57';

const EXTENSION_ID = 'st-external-statusbar';
const EXTENSION_VERSION = '0.3.57';
const SOURCE_MODE_PROMPT = 'prompt';
const SOURCE_MODE_IMPORT = 'import';
const WORLDBOOK_CATEGORY_ORDER = [
  ['global', '全局世界书'],
  ['character', '角色世界书'],
  ['chat', '聊天世界书'],
  ['inactive', '未启用世界书'],
];

const DEFAULT_SETTINGS = {
  enabled: false,
  mode: 'manual',
  activeTab: 'workspace',
  taskPrompt: '仅根据最新助手回复生成文末状态栏组件，不要续写正文。',
  apiUrl: '',
  apiKey: '',
  apiModel: '',
  apiModelOptions: [],
  maxTokens: '800',
  temperature: '0.7',
  injectMode: 'replace',
  cleanupTags: '',
  lastGenerated: '',
  lastPromptLog: '',
  ballX: 16,
  ballY: 16,
  ballVisible: false,
  activeSourcePreset: '',
  sourceMode: SOURCE_MODE_PROMPT,
  promptSelections: {},
  importSelections: {},
  components: [],
};

const targetWindow = (() => {
  try { return window.parent?.document?.body ? window.parent : window; } catch (_) { return window; }
})();
const targetDoc = targetWindow.document;
let initialized = false;
let settings = { ...DEFAULT_SETTINGS };
let importCandidates = [];
let importGroups = [];
let activeWorldbookGroupIndex = null;
let generationAbortController = null;
let lastRuntimeDiagnostics = {};

const $t = (selectorOrHtml) => $(selectorOrHtml, targetDoc);
const textOf = (value) => String(value ?? '').trim();
const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function getSettingsStore() {
  const context = getContext();
  context.extensionSettings[EXTENSION_ID] ??= {};
  return context.extensionSettings[EXTENSION_ID];
}

function loadSettings() {
  settings = Object.assign({ ...DEFAULT_SETTINGS }, getSettingsStore());
  if (!Array.isArray(settings.components)) settings.components = [];
  if (!Array.isArray(settings.apiModelOptions)) settings.apiModelOptions = [];
  if (!settings.promptSelections || typeof settings.promptSelections !== 'object') settings.promptSelections = {};
  if (!settings.importSelections || typeof settings.importSelections !== 'object') settings.importSelections = {};
  if (![SOURCE_MODE_PROMPT, SOURCE_MODE_IMPORT].includes(settings.sourceMode)) settings.sourceMode = SOURCE_MODE_PROMPT;
  settings.components = settings.components.map((item) => normalizeComponent(item, targetWindow, getContext()));
}

function saveSettings() {
  Object.assign(getSettingsStore(), settings);
  getContext().saveSettingsDebounced();
}

function getLatestAssistantMessage(chat) {
  for (let i = chat.length - 1; i >= 0; i -= 1) {
    const item = chat[i];
    if (!item?.is_user && item?.mes) return { index: i, message: item };
  }
  return null;
}

function getEnabledComponents() {
  return getActiveComponentsForContext(settings.components, targetWindow, getContext());
}

function cleanGeneratedText(text) {
  const tags = String(settings.cleanupTags || '').split('\n').map((item) => item.trim()).filter(Boolean);
  return tags.reduce((current, tag) => current.split(tag).join(''), String(text || '')).trim();
}

async function buildMessages(latestMessage) {
  const context = getContext();
  const components = getEnabledComponents();
  const promptSourceItems = await ensurePromptSourceItemsForGeneration();
  const messages = await buildExternalStatusbarMessages({ targetWindow, context, latestMessage, taskPrompt: settings.taskPrompt, components, promptSourceItems, substituteParams: context.substituteParams });
  lastRuntimeDiagnostics = createRuntimePromptDiagnostics({ context, promptSourceItems: messages.promptSourceItems || promptSourceItems, runtimeInsertions: messages.runtimeInsertions });
  return messages;
}

function setGeneratingState(isGenerating) {
  const button = $t('#st-esg-generate');
  if (!button.length) return;
  button.toggleClass('st-esg-danger-action', isGenerating);
  button.find('i').attr('class', isGenerating ? 'fa-solid fa-stop' : 'fa-solid fa-sparkles');
  button.find('span').text(isGenerating ? '停止生成' : '生成状态栏');
}

async function callExternalApi(latestMessage, signal) {
  const apiUrl = normalizeChatCompletionsUrl(settings.apiUrl);
  const model = textOf(settings.apiModel);
  if (!apiUrl || !model) throw new Error('请先在“API 设置”里填写 API 地址和模型名称。');
  const messages = await buildMessages(latestMessage);
  settings.lastPromptLog = createPromptLog({ apiUrl, apiKey: settings.apiKey, model, maxTokens: settings.maxTokens, temperature: settings.temperature, messages, extensionVersion: EXTENSION_VERSION, runtimeDiagnostics: lastRuntimeDiagnostics });
  saveSettings();
  $t('#st-esg-prompt-log').val(settings.lastPromptLog);
  console.log(`[${EXTENSION_ID}] 外置状态栏 API 请求提示词`, JSON.parse(settings.lastPromptLog));
  const response = await fetch(apiUrl, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) },
    body: JSON.stringify({ model, messages, max_tokens: Number(settings.maxTokens) || 800, temperature: Number(settings.temperature) || 0.7 }),
  });
  if (!response.ok) throw new Error(`API 请求失败：${response.status} ${(await response.text().catch(() => '')).slice(0, 160)}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
  if (!content.trim()) throw new Error('API 返回为空。');
  return cleanGeneratedText(content);
}

function buildFallbackStatusbar(latestMessage) {
  return cleanGeneratedText(['[外置状态栏生成器]', `任务：${settings.taskPrompt}`, '状态：尚未配置独立 API，因此这里是本地占位输出。', `启用组件数：${getEnabledComponents().length}`, `最新助手回复长度：${latestMessage.mes.length} 个字符`].join('\n'));
}

function injectStatusbar(message, text) {
  message.mes = injectStatusbarText(message.mes, text, { mode: settings.injectMode });
}

async function generateStatusbar() {
  if (generationAbortController) {
    generationAbortController.abort();
    return '';
  }
  const context = getContext();
  const latest = getLatestAssistantMessage(context.chat);
  if (!latest) { setStatus('没有找到可用于生成的助手回复。'); return ''; }
  setStatus('正在生成状态栏……');
  generationAbortController = new AbortController();
  setGeneratingState(true);
  let result = '';
  try { result = settings.apiUrl ? await callExternalApi(latest.message, generationAbortController.signal) : buildFallbackStatusbar(latest.message); }
  catch (error) {
    setStatus(error?.name === 'AbortError' ? '已停止生成。提示词日志已保留。' : error?.message || '生成失败。');
    return '';
  } finally {
    generationAbortController = null;
    setGeneratingState(false);
  }
  settings.lastGenerated = result;
  saveSettings();
  $t('#st-esg-preview').val(result);
  switchTab('workspace');
  setStatus('已生成状态栏内容，等待检查或注入。');
  return result;
}

async function injectGeneratedStatusbar() {
  const context = getContext();
  const latest = getLatestAssistantMessage(context.chat);
  if (!latest) { setStatus('没有找到可注入的助手回复。'); return; }
  const text = settings.lastGenerated || $t('#st-esg-preview').val() || await generateStatusbar();
  if (!text) return;
  injectStatusbar(latest.message, cleanGeneratedText(text));
  if (Array.isArray(latest.message.swipes) && Number.isInteger(latest.message.swipe_id)) latest.message.swipes[latest.message.swipe_id] = latest.message.mes;
  context.updateMessageBlock(latest.index, latest.message);
  await context.saveChat();
  setStatus('已注入到最新助手回复。');
}

async function handleGenerationEnded() {
  if (!settings.enabled || settings.mode === 'manual') return;
  const result = await generateStatusbar();
  if (settings.mode === 'autoInject' && result) await injectGeneratedStatusbar();
}

function setStatus(text) { $t('#st-esg-status').text(text); }

async function copyTextToClipboard(text) {
  const value = String(text || '');
  if (!value) return false;
  try {
    await targetWindow.navigator?.clipboard?.writeText?.(value);
    return true;
  } catch (_) {
    const field = targetDoc.getElementById('st-esg-prompt-log');
    field?.focus?.();
    field?.select?.();
    return false;
  }
}

function renderModelOptions() {
  const options = Array.isArray(settings.apiModelOptions) ? settings.apiModelOptions : [];
  $t('#st-esg-model-options').html(options.map((model) => `<option value="${escapeHtml(model)}"></option>`).join(''));
}

async function fetchApiModels() {
  const modelsUrl = normalizeModelsUrl(settings.apiUrl);
  if (!modelsUrl) { setStatus('请先填写 API 地址。'); return; }
  setStatus('正在拉取模型列表……');
  try {
    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) },
    });
    if (!response.ok) throw new Error(`拉取模型失败：${response.status} ${(await response.text().catch(() => '')).slice(0, 160)}`);
    const models = extractModelIds(await response.json());
    if (!models.length) throw new Error('没有从接口返回中识别到模型。');
    settings.apiModelOptions = models;
    if (!textOf(settings.apiModel)) settings.apiModel = models[0];
    saveSettings();
    renderModelOptions();
    $t('#st-esg-api-model').val(settings.apiModel);
    setStatus(`已拉取 ${models.length} 个模型。`);
  } catch (error) {
    setStatus(error?.message || '拉取模型失败。');
  }
}

function switchTab(tabName) {
  const nextTab = tabName || 'workspace';
  $t('.st-esg-tab').removeClass('active');
  $t(`.st-esg-tab[data-tab="${nextTab}"]`).addClass('active');
  $t('.st-esg-tab-panel').removeClass('active');
  $t(`.st-esg-tab-panel[data-tab-panel="${nextTab}"]`).addClass('active');
  settings.activeTab = nextTab;
  saveSettings();
  if (nextTab === 'sources' && !importGroups.length) scanImportCandidates();
}

function getDialog() { return targetDoc.getElementById('st-esg-dialog'); }

function closeSillyTavernOverlays() {
  // The magic-wand menu is a Popper dropdown on mobile. If it stays open, it can sit above
  // extension UI and make our panel look "covered" even when the panel itself opened.
  const wandMenu = targetDoc.getElementById('extensionsMenu') || targetDoc.getElementById('extensions_menu');
  if (wandMenu) {
    $(wandMenu).stop(true, true).hide();
  }

  // Close unpinned navbar drawers that may occupy the mobile viewport.
  $t('.openIcon:not(.drawerPinnedOpen)').removeClass('openIcon').addClass('closedIcon');
  $t('.openDrawer').not('.drawerPinnedOpen').removeClass('openDrawer').addClass('closedDrawer');
}

function togglePanel(forceOpen) {
  const dialog = getDialog();
  if (!dialog) return;
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !dialog.open;
  if (shouldOpen) {
    closeSillyTavernOverlays();
    targetDoc.body.appendChild(dialog);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  } else if (dialog.open && typeof dialog.close === 'function') {
    dialog.close();
  } else {
    dialog.removeAttribute('open');
  }
  $t('#st-esg-menu-button').toggleClass('selected', shouldOpen);
  $t('#st-esg-ball').toggleClass('selected', shouldOpen);
}

function renderMagicWandMenuButton(retry = 0) {
  if (targetDoc.getElementById('st-esg-menu-button')) return;
  if (retry > 30) return;
  const menu = targetDoc.getElementById('extensions_menu') || targetDoc.getElementById('extensionsMenu');
  if (!menu) { targetWindow.setTimeout(() => renderMagicWandMenuButton(retry + 1), 500); return; }
  const button = targetDoc.createElement('div');
  button.id = 'st-esg-menu-button';
  button.className = 'list-group-item flex-container flexGap5 interactable';
  button.tabIndex = 0;
  button.title = '外置状态栏生成器';
  button.innerHTML = '<span><i class="fa-solid fa-wand-magic-sparkles"></i></span><span>状态栏生成器</span>';
  button.addEventListener('click', () => togglePanel(true));
  menu.prepend(button);
}

function renderFloatingBall() {
  if (!settings.ballVisible) { $t('#st-esg-ball').remove(); return; }
  if (targetDoc.getElementById('st-esg-ball')) return;
  const ball = $('<button id="st-esg-ball" type="button" title="外置状态栏生成器"><i class="fa-solid fa-wand-magic-sparkles"></i></button>');
  ball.css({ left: `${settings.ballX ?? 16}px`, bottom: `${settings.ballY ?? 16}px` });
  targetDoc.body.appendChild(ball[0]);
  let dragging = false, moved = false, startX = 0, startY = 0, originLeft = settings.ballX ?? 16, originBottom = settings.ballY ?? 16;
  const onMove = (event) => {
    if (!dragging) return;
    const dx = event.clientX - startX, dy = event.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    ball.css({ left: `${clamp(originLeft + dx, 0, targetWindow.innerWidth - 46)}px`, bottom: `${clamp(originBottom - dy, 0, targetWindow.innerHeight - 46)}px` });
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    targetWindow.removeEventListener('pointermove', onMove);
    targetWindow.removeEventListener('pointerup', onUp);
    settings.ballX = parseFloat(ball.css('left')) || 16;
    settings.ballY = parseFloat(ball.css('bottom')) || 16;
    saveSettings();
    if (!moved) togglePanel();
  };
  ball.on('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault(); dragging = true; moved = false;
    startX = event.clientX; startY = event.clientY;
    originLeft = parseFloat(ball.css('left')) || 16; originBottom = parseFloat(ball.css('bottom')) || 16;
    targetWindow.addEventListener('pointermove', onMove); targetWindow.addEventListener('pointerup', onUp);
  });
}

function renderComponentList() {
  const list = $t('#st-esg-component-list');
  if (!list.length) return;
  if (!settings.components.length) { list.html('<div class="st-esg-empty">还没有组件。可以手动添加，也可以点“刷新可选来源”，从预设或世界书条目里勾选导入。</div>'); return; }
  settings.components = settings.components.map((item) => normalizeComponent(item, targetWindow, getContext()));
  const sections = [
    { scope: COMPONENT_SCOPE_GLOBAL, title: '全局组件', desc: '开启后一直参与状态栏生成。' },
    { scope: COMPONENT_SCOPE_PRESET, title: '预设组件', desc: '只在绑定的预设正在使用时参与生成。' },
    { scope: COMPONENT_SCOPE_CHARACTER, title: '角色组件', desc: '只在绑定的角色卡聊天时参与生成。' },
  ];
  list.html(sections.map((section) => {
    const folders = getComponentLibraryFolders(settings.components, section.scope);
    const count = folders.reduce((sum, folder) => sum + folder.items.length, 0);
    const folderHtml = folders.map((folder) => `<details class="st-esg-component-folder"><summary class="st-esg-component-folder-head"><div><div class="st-esg-component-folder-title">${escapeHtml(folder.name)}</div><div class="st-esg-card-desc">${folder.items.length} 个条目</div></div><em>${folder.items.filter((item) => item.enabled !== false).length}/${folder.items.length} 启用</em></summary><div class="st-esg-component-folder-body">${folder.items.map((item) => `<details class="st-esg-component-item" data-index="${item.index}"><summary class="st-esg-component-item-head"><label class="st-esg-checkbox"><input class="st-esg-component-enabled" type="checkbox" ${item.enabled === false ? '' : 'checked'} /><span>${escapeHtml(item.name || '未命名组件')}</span></label>${item.bindName ? `<em>${escapeHtml(item.bindName)}</em>` : ''}<button class="menu_button st-esg-component-delete" type="button">删除</button></summary><div class="st-esg-component-preview" data-loaded="false"></div></details>`).join('')}</div></details>`).join('');
    return `<details class="st-esg-component-section" open><summary class="st-esg-component-section-head"><div><div class="st-esg-import-group-title">${section.title}</div><div class="st-esg-card-desc">${section.desc}</div></div><em>${count} 个</em></summary><div class="st-esg-component-section-body">${folderHtml || '<div class="st-esg-empty st-esg-empty-small">暂无组件</div>'}</div></details>`;
  }).join(''));
  saveSettings();
  $t('.st-esg-component-enabled').on('click', (event) => event.stopPropagation());
  $t('.st-esg-component-enabled').on('change', function () { settings.components[Number($(this).closest('.st-esg-component-item').data('index'))].enabled = Boolean($(this).prop('checked')); saveSettings(); });
  $t('.st-esg-component-delete').on('click', function (event) { event.preventDefault(); event.stopPropagation(); settings.components.splice(Number($(this).closest('.st-esg-component-item').data('index')), 1); saveSettings(); renderComponentList(); });
  $t('.st-esg-component-item').on('toggle', function () {
    if (!this.open) return;
    const preview = this.querySelector('.st-esg-component-preview');
    if (!preview || preview.dataset.loaded === 'true') return;
    const item = settings.components[Number($(this).data('index'))];
    preview.innerHTML = `<pre>${escapeHtml(item?.content || '')}</pre>`;
    preview.dataset.loaded = 'true';
  });
}

function addComponent() {
  const name = textOf($t('#st-esg-component-name').val());
  const scope = textOf($t('#st-esg-component-scope').val()) || COMPONENT_SCOPE_GLOBAL;
  const content = textOf($t('#st-esg-component-content').val());
  if (!content) { setStatus('组件内容不能为空。'); return; }
  settings.components.push({ id: String(Date.now()), name: name || '未命名组件', scope, bindName: getComponentBindingName(scope, targetWindow, getContext()), content, enabled: true, sourceType: '手动', folderName: '手动添加' });
  $t('#st-esg-component-name').val(''); $t('#st-esg-component-content').val('');
  saveSettings(); renderComponentList(); setStatus('已添加组件。');
}

function getImportTarget() {
  const scope = textOf($t('#st-esg-import-target-scope').val()) || COMPONENT_SCOPE_GLOBAL;
  return { scope, bindName: getComponentBindingName(scope, targetWindow, getContext()) };
}

function findImportedComponentIndex(item, scope, bindName) {
  return settings.components.findIndex((component) => (
    textOf(component.sourceType) === textOf(item?.scope)
    && textOf(component.source) === textOf(item?.source)
    && textOf(component.name) === textOf(item?.name)
    && textOf(component.content) === textOf(item?.content)
    && textOf(component.scope) === textOf(scope)
    && textOf(component.bindName) === textOf(bindName)
  ));
}

function getSourceSelectionStore() {
  return settings.sourceMode === SOURCE_MODE_IMPORT ? settings.importSelections : settings.promptSelections;
}

function getSourceSelection(item) {
  if (item?.locked) return item.enabled !== false;
  const store = getSourceSelectionStore();
  if (Object.prototype.hasOwnProperty.call(store, item.key)) return store[item.key] !== false;
  return settings.sourceMode === SOURCE_MODE_PROMPT ? item.enabled !== false : false;
}

function setSourceSelection(item, checked) {
  if (!item?.key || item?.locked) return;
  getSourceSelectionStore()[item.key] = Boolean(checked);
  saveSettings();
}

function syncSelectionForChecks(checks) {
  checks.toArray().forEach((checkbox) => {
    const row = $(checkbox).closest('.st-esg-import-item');
    const group = importGroups[Number(row.data('group-index'))];
    const item = group?.items?.[Number(row.data('item-index'))];
    if (item) setSourceSelection(item, Boolean($(checkbox).prop('checked')));
  });
}

function syncPromptSelectionsFromLoadedGroups(groups = importGroups) {
  if (settings.sourceMode !== SOURCE_MODE_PROMPT) return 0;
  const before = JSON.stringify(settings.promptSelections || {});
  settings.promptSelections = syncPromptSelectionsFromGroups(groups, settings.promptSelections);
  if (JSON.stringify(settings.promptSelections || {}) !== before) saveSettings();
  return groups.reduce((sum, group) => sum + (group?.loaded && Array.isArray(group.items) ? group.items.length : 0), 0);
}

async function ensurePromptSourceItemsForGeneration() {
  if (settings.sourceMode !== SOURCE_MODE_PROMPT) return [];
  if (!importGroups.length) await scanImportCandidates();
  const activeWorldbookGroups = importGroups.filter((group) => group?.scope === SOURCE_WORLDBOOK && group.category !== 'inactive' && !group.loaded && !group.loading);
  for (const group of activeWorldbookGroups) {
    group.loading = true;
    try {
      group.items = await collectWorldbookImportCandidates(targetWindow, group.source);
      group.loaded = true;
      syncPromptSelectionsFromLoadedGroups([group]);
    } catch (error) {
      group.error = error?.message || '加载失败';
    } finally {
      group.loading = false;
    }
  }
  importCandidates = importGroups.flatMap((group) => group.items || []);
  renderImportCandidates({ renderPreset: false });
  return collectSelectedPromptSourceItems(importGroups, settings.promptSelections);
}

function getSourceModeInfo() {
  return settings.sourceMode === SOURCE_MODE_IMPORT
    ? { title: '导入组件库模式', desc: '当前勾选只用于导入组件库，不影响外置生成提示词。', checkedText: '准备导入', uncheckedText: '不导入', actionText: '导入勾选条目' }
    : { title: '提示词模式', desc: '点击“同步勾选状态”会用酒馆当前预设/世界书启用状态覆盖这里的勾选。', checkedText: '生成启用', uncheckedText: '生成停用', actionText: '已自动保存勾选' };
}

function renderSourceModeUi() {
  const info = getSourceModeInfo();
  $t('#st-esg-source-mode').val(settings.sourceMode);
  $t('#st-esg-source-mode-title').text(info.title);
  $t('#st-esg-source-mode-desc').text(info.desc);
  $t('#st-esg-scan-components span').text(settings.sourceMode === SOURCE_MODE_PROMPT ? '同步勾选状态' : '同步来源');
  $t('#st-esg-import-components span').text(info.actionText);
  $t('#st-esg-import-target-scope').closest('label').toggle(settings.sourceMode === SOURCE_MODE_IMPORT);
}

function captureImportViewState() {
  const box = $t('#st-esg-worldbook-candidates');
  return {
    listScrollTop: box.length ? box.scrollTop() : 0,
    openGroups: new Set($t('.st-esg-import-group[open]').toArray().map((node) => Number($(node).data('group-index')))),
  };
}

function restoreImportViewState(state) {
  if (!state) return;
  const box = $t('#st-esg-worldbook-candidates');
  if (box.length) box.scrollTop(state.listScrollTop || 0);
}

function scrollWorldbookCardIntoView() {
  const worldbookBox = targetDoc.getElementById('st-esg-worldbook-candidates');
  const card = worldbookBox?.closest?.('.st-esg-card');
  if (!card) return;
  targetWindow.requestAnimationFrame(() => card.scrollIntoView({ block: 'start', inline: 'nearest' }));
}

async function openWorldbookDetail(groupIndex) {
  activeWorldbookGroupIndex = Number(groupIndex);
  renderImportCandidates({ renderPreset: false });
  scrollWorldbookCardIntoView();
  await loadImportGroup(activeWorldbookGroupIndex);
  scrollWorldbookCardIntoView();
}

function backToWorldbookList() {
  activeWorldbookGroupIndex = null;
  renderImportCandidates({ renderPreset: false });
  scrollWorldbookCardIntoView();
}

function renderSourcePresetSelect() {
  const select = $t('#st-esg-source-preset');
  if (!select.length) return;
  const names = getPresetNamesSafe(targetWindow, getContext());
  const current = settings.activeSourcePreset || getCurrentPresetNameSafe(targetWindow, getContext()) || names[0] || '';
  if (!settings.activeSourcePreset && current) settings.activeSourcePreset = current;
  select.html(names.map((name) => `<option value="${escapeHtml(name)}" ${name === current ? 'selected' : ''}>${escapeHtml(name)}</option>`).join(''));
}

function getSelectedGlobalWorldbookNamesFromDom() {
  const selectedLabels = $t('#world_info option:selected')
    .map((_, option) => textOf($(option).text()))
    .get()
    .filter(Boolean);
  if (selectedLabels.length) return selectedLabels;
  const value = $t('#world_info').val() || [];
  return (Array.isArray(value) ? value : [value]).map(textOf).filter(Boolean);
}

async function scanImportCandidates() {
  const context = getContext();
  const selectedWorldNames = getSelectedGlobalWorldbookNamesFromDom();
  settings.activeSourcePreset = textOf($t('#st-esg-source-preset').val()) || settings.activeSourcePreset || getCurrentPresetNameSafe(targetWindow, context);
  saveSettings();
  importGroups = [
    ...collectPresetImportGroups({ targetWindow, context, presetName: settings.activeSourcePreset }),
    ...collectWorldbookImportGroups({ targetWindow, context, selectedWorldNames }),
  ];
  settings.lastPromptLog = JSON.stringify({
    type: 'source-scan-debug',
    extensionVersion: EXTENSION_VERSION,
    preset: settings.activeSourcePreset,
    sourceMode: settings.sourceMode,
    generatedAt: new Date().toISOString(),
    groupCount: importGroups.length,
    groups: importGroups.map((group) => ({
      source: group.source,
      scope: group.scope,
      loaded: group.loaded,
      debug: group.debug || null,
      itemCount: Array.isArray(group.items) ? group.items.length : 0,
      markerTypes: (Array.isArray(group.items) ? group.items : []).map((item) => item?.markerType).filter(Boolean),
      itemNames: (Array.isArray(group.items) ? group.items : []).map((item) => item?.name).filter(Boolean),
    })),
  }, null, 2);
  $t('#st-esg-prompt-log').val(settings.lastPromptLog);
  saveSettings();
  const syncedCount = syncPromptSelectionsFromLoadedGroups(importGroups);
  activeWorldbookGroupIndex = null;
  importCandidates = importGroups.flatMap((group) => group.items || []);
  renderImportCandidates();
  setStatus(settings.sourceMode === SOURCE_MODE_PROMPT ? `已同步 ${syncedCount} 个已加载条目的酒馆勾选状态。世界书会在进入详情页时同步。` : `已列出 ${importGroups.length} 个来源。世界书会在进入详情页时加载。`);
}

async function loadImportGroup(groupIndex) {
  const group = importGroups[groupIndex];
  if (!group || group.loaded || group.loading || group.scope !== SOURCE_WORLDBOOK) return;
  group.uiOpen = true;
  group.loading = true;
  renderImportCandidates({ renderPreset: false });
  scrollWorldbookCardIntoView();
  try {
    group.items = await collectWorldbookImportCandidates(targetWindow, group.source);
    group.loaded = true;
    syncPromptSelectionsFromLoadedGroups([group]);
    setStatus(`已加载 ${group.source}：${group.items.length} 个条目。`);
  } catch (error) {
    group.error = error?.message || '加载失败';
    setStatus(`加载 ${group.source} 失败。`);
  } finally {
    group.loading = false;
    importCandidates = importGroups.flatMap((item) => item.items || []);
    renderImportCandidates({ renderPreset: false });
    scrollWorldbookCardIntoView();
  }
}

function renderImportCandidates({ renderPreset = true, renderWorldbook = true } = {}) {
  const presetBox = $t('#st-esg-preset-candidates');
  const worldbookBox = $t('#st-esg-worldbook-candidates');
  if (!presetBox.length && !worldbookBox.length) return;
  if (!importGroups.length) {
    if (renderPreset) presetBox.html('<div class="st-esg-empty st-esg-empty-small">还没有预设条目。选择预设后点击“同步来源”。</div>');
    if (renderWorldbook) worldbookBox.html('<div class="st-esg-empty st-esg-empty-small">还没有世界书来源。点击“同步来源”后会按分类列出。</div>');
    return;
  }
  const viewState = captureImportViewState();
  const groupsWithIndex = importGroups.map((group, groupIndex) => ({ ...group, groupIndex }));
  const presetGroups = groupsWithIndex.filter((group) => group.scope !== SOURCE_WORLDBOOK);
  const worldbookGroups = groupsWithIndex.filter((group) => group.scope === SOURCE_WORLDBOOK);
  const worldbookCategories = new Map();
  WORLDBOOK_CATEGORY_ORDER.forEach(([category, categoryLabel]) => worldbookCategories.set(category, { categoryLabel, groups: [] }));
  worldbookGroups.forEach((group) => {
    const category = group.category || 'inactive';
    if (!worldbookCategories.has(category)) worldbookCategories.set(category, { categoryLabel: group.categoryLabel || '世界书', groups: [] });
    worldbookCategories.get(category).groups.push(group);
  });
  const countItems = (groups) => groups.reduce((sum, group) => sum + (group.loaded ? group.items.length : 0), 0);
  const groupBody = (group) => {
    const modeInfo = getSourceModeInfo();
    if (group.loading) return '<div class="st-esg-empty st-esg-empty-small">正在加载这本世界书...</div>';
    if (group.error) return `<div class="st-esg-empty st-esg-empty-small">${escapeHtml(group.error)}</div>`;
    if (!group.loaded) return '<div class="st-esg-empty st-esg-empty-small">展开后才加载条目，避免刷新卡顿。</div>';
    if (!group.items.length) return '<div class="st-esg-empty st-esg-empty-small">没有可导入条目</div>';
    return group.items.map((item, itemIndex) => {
      const checked = getSourceSelection(item);
      if (item.locked) return `<div class="st-esg-import-item st-esg-import-item-locked" data-group-index="${group.groupIndex}" data-item-index="${itemIndex}"><label class="st-esg-checkbox"><i class="fa-solid fa-lock"></i><span>${escapeHtml(item.name)}</span></label><em>原生占位符</em></div>`;
      return `<div class="st-esg-import-item" data-group-index="${group.groupIndex}" data-item-index="${itemIndex}"><label class="st-esg-checkbox"><input class="st-esg-import-check" type="checkbox" ${checked ? 'checked' : ''} /><span>${escapeHtml(item.name)}</span></label><em>${checked ? modeInfo.checkedText : modeInfo.uncheckedText}</em></div>`;
    }).join('');
  };
  const renderGroup = (group) => {
    const shouldOpen = group.uiOpen || viewState.openGroups.has(group.groupIndex) || (group.loaded && group.scope !== SOURCE_WORLDBOOK);
    return `<details class="st-esg-import-group" data-group-index="${group.groupIndex}" ${shouldOpen ? 'open' : ''}><summary class="st-esg-import-group-head"><div><div class="st-esg-import-group-title">${escapeHtml(group.group)}</div><div class="st-esg-card-desc">${group.loaded ? `${group.items.length} 个可导入条目` : '未加载，点开读取'}</div></div>${group.loaded ? '<button class="menu_button st-esg-import-group-toggle" type="button">本组全选</button>' : ''}</summary><div class="st-esg-import-group-list">${groupBody(group)}</div></details>`;
  };
  const renderWorldbookRow = (group) => `<button class="st-esg-worldbook-row" type="button" data-group-index="${group.groupIndex}"><span>${escapeHtml(group.group)}</span><em>${group.loaded ? `${group.items.length} 个条目` : '点进查看'}</em><i class="fa-solid fa-chevron-right"></i></button>`;
  const renderWorldbookDetail = (group) => `<div class="st-esg-worldbook-detail" data-group-index="${group.groupIndex}"><div class="st-esg-detail-head"><button class="menu_button st-esg-back-worldbooks" type="button"><i class="fa-solid fa-arrow-left"></i><span>返回世界书列表</span></button><div><div class="st-esg-import-group-title">${escapeHtml(group.group)}</div><div class="st-esg-card-desc">${group.loading ? '正在加载条目...' : group.loaded ? `${group.items.length} 个可导入条目` : '准备加载这本世界书'}</div></div>${group.loaded ? '<button class="menu_button st-esg-import-detail-toggle" type="button">本书全选</button>' : ''}</div><div class="st-esg-import-group-list">${groupBody(group)}</div></div>`;
  const detailGroup = activeWorldbookGroupIndex === null ? null : groupsWithIndex.find((group) => group.groupIndex === activeWorldbookGroupIndex && group.scope === SOURCE_WORLDBOOK);
  const worldbookSection = detailGroup
    ? renderWorldbookDetail(detailGroup)
    : (worldbookGroups.length ? `<details class="st-esg-import-scope" open><summary class="st-esg-import-scope-summary"><span>世界书</span><em>${worldbookGroups.length} 本来源</em></summary><div class="st-esg-import-scope-body">${[...worldbookCategories.values()].filter((category) => category.groups.length).map((category) => `<details class="st-esg-import-category" open><summary class="st-esg-import-category-summary"><span>${escapeHtml(category.categoryLabel)}</span><em>${category.groups.length} 本</em></summary><div class="st-esg-import-category-body">${category.groups.map(renderWorldbookRow).join('')}</div></details>`).join('')}</div></details>` : '');
  if (renderPreset) presetBox.html(presetGroups.length ? presetGroups.map(renderGroup).join('') : '<div class="st-esg-empty st-esg-empty-small">当前预设没有可导入条目。</div>');
  if (renderWorldbook) worldbookBox.html(worldbookSection || '<div class="st-esg-empty st-esg-empty-small">没有世界书来源。</div>');
  restoreImportViewState(viewState);
  if (renderPreset) $t('.st-esg-import-group').on('toggle', function () {
    const groupIndex = Number($(this).data('group-index'));
    if (importGroups[groupIndex]) importGroups[groupIndex].uiOpen = this.open;
    if (this.open) loadImportGroup(groupIndex);
  });
  if (renderWorldbook) $t('.st-esg-worldbook-row').on('click', function () { openWorldbookDetail(Number($(this).data('group-index'))); });
  if (renderWorldbook) $t('.st-esg-back-worldbooks').on('click', backToWorldbookList);
  $t('.st-esg-import-check').off('.stEsgSource');
  $t('.st-esg-import-check').on('click.stEsgSource', (event) => event.stopPropagation());
  $t('.st-esg-import-check').on('change.stEsgSource', function () {
    const row = $(this).closest('.st-esg-import-item');
    const group = importGroups[Number(row.data('group-index'))];
    const item = group?.items?.[Number(row.data('item-index'))];
    setSourceSelection(item, Boolean($(this).prop('checked')));
    $(this).closest('.st-esg-import-item').find('em').text($(this).prop('checked') ? getSourceModeInfo().checkedText : getSourceModeInfo().uncheckedText);
  });
  if (renderPreset) $t('.st-esg-import-group-toggle').on('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
    const checks = $(this).closest('.st-esg-import-group').find('.st-esg-import-check');
    const shouldCheck = checks.toArray().some((item) => !$(item).prop('checked'));
    checks.prop('checked', shouldCheck);
    syncSelectionForChecks(checks);
    checks.closest('.st-esg-import-item').find('em').text(shouldCheck ? getSourceModeInfo().checkedText : getSourceModeInfo().uncheckedText);
    $(this).text(shouldCheck ? '取消本组' : '本组全选');
  });
  if (renderWorldbook) $t('.st-esg-import-detail-toggle').on('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
    const checks = $(this).closest('.st-esg-worldbook-detail').find('.st-esg-import-check');
    const shouldCheck = checks.toArray().some((item) => !$(item).prop('checked'));
    checks.prop('checked', shouldCheck);
    syncSelectionForChecks(checks);
    checks.closest('.st-esg-import-item').find('em').text(shouldCheck ? getSourceModeInfo().checkedText : getSourceModeInfo().uncheckedText);
    $(this).text(shouldCheck ? '取消本书' : '本书全选');
  });
}

function importCheckedCandidates() {
  if (settings.sourceMode !== SOURCE_MODE_IMPORT) {
    setStatus('当前是提示词模式：勾选已自动保存为生成来源，不会导入组件库。');
    return;
  }
  const checked = $t('.st-esg-import-check:checked').toArray();
  if (!checked.length) { setStatus('请先勾选要导入的候选组件。'); return; }
  const { scope: targetScope, bindName } = getImportTarget();
  let added = 0;
  let updated = 0;
  for (const checkbox of checked) {
    const row = $(checkbox).closest('.st-esg-import-item');
    const group = importGroups[Number(row.data('group-index'))];
    const item = group?.items?.[Number(row.data('item-index'))];
    if (!item) continue;
    const existingIndex = findImportedComponentIndex(item, targetScope, bindName);
    const importedComponent = { name: item.name, scope: targetScope, bindName, content: item.content, enabled: true, source: item.source, sourceType: item.scope, sourceOrder: item.sourceOrder, sourceUid: item.sourceUid, folderName: getComponentFolderName(item) };
    if (existingIndex >= 0) {
      settings.components[existingIndex] = { ...settings.components[existingIndex], ...importedComponent };
      updated += 1;
    } else {
      settings.components.push({ id: String(Date.now() + Math.random()), ...importedComponent });
      added += 1;
    }
  }
  saveSettings(); renderComponentList(); renderImportCandidates(); setStatus(`已同步 ${checked.length} 个组件：新增 ${added} 个，更新 ${updated} 个。`);
}

function renderPluginPanel() {
  if (targetDoc.getElementById('st-esg-dialog')) return;
  const dialog = targetDoc.createElement('dialog');
  dialog.id = 'st-esg-dialog';
  dialog.className = 'st-esg-dialog';
  dialog.innerHTML = `
    <div class="st-esg-shell">
      <div class="st-esg-panel-header"><div class="st-esg-panel-title"><div class="st-esg-title-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></div><div><div class="st-esg-kicker">SillyTavern 插件</div><div class="st-esg-title-text">外置状态栏生成器</div></div></div><div id="st-esg-close" class="menu_button fa-solid fa-xmark" title="关闭面板"></div></div>
      <div class="st-esg-panel-body">
        <nav class="st-esg-tabs" aria-label="外置状态栏生成器分页"><button class="st-esg-tab" type="button" data-tab="workspace"><i class="fa-solid fa-sparkles"></i><span>生成结果</span></button><button class="st-esg-tab" type="button" data-tab="runtime"><i class="fa-solid fa-sliders"></i><span>运行设置</span></button><button class="st-esg-tab" type="button" data-tab="api"><i class="fa-solid fa-plug"></i><span>API 设置</span></button><button class="st-esg-tab" type="button" data-tab="sources"><i class="fa-solid fa-book-open"></i><span>预设/世界书</span></button><button class="st-esg-tab" type="button" data-tab="components"><i class="fa-solid fa-layer-group"></i><span>组件库</span></button><button class="st-esg-tab" type="button" data-tab="debug"><i class="fa-solid fa-bug"></i><span>提示词日志</span></button><button class="st-esg-tab" type="button" data-tab="output"><i class="fa-solid fa-code"></i><span>输出注入</span></button></nav>
        <section class="st-esg-tab-panel" data-tab-panel="workspace"><div class="st-esg-card"><div class="st-esg-card-head"><div><div class="st-esg-card-title">生成内容</div><div class="st-esg-card-desc">这里是状态栏生成结果。你可以先检查，再注入最新回复。</div></div></div><textarea id="st-esg-preview" class="text_pole textarea_compact st-esg-textarea st-esg-preview" rows="11" placeholder="生成后的状态栏会出现在这里。"></textarea></div><div class="st-esg-workflow"><div class="st-esg-step"><b>1</b><span>读取最新助手回复</span></div><div class="st-esg-step"><b>2</b><span>按组件与任务生成</span></div><div class="st-esg-step"><b>3</b><span>预览后写回正文末尾</span></div></div></section>
        <section class="st-esg-tab-panel" data-tab-panel="runtime"><div class="st-esg-card"><div class="st-esg-card-head"><div><div class="st-esg-card-title">运行模式</div><div class="st-esg-card-desc">控制插件是否监听正文生成，以及生成后是否自动注入。</div></div><label class="st-esg-switch"><input id="st-esg-enabled" type="checkbox" /><span></span><em>启用</em></label></div><select id="st-esg-mode" class="text_pole st-esg-select"><option value="autoInject">自动生成，并自动注入最新回复</option><option value="autoReview">自动生成，但手动确认注入</option><option value="manual">手动点击生成，手动注入</option></select></div><div class="st-esg-card"><div class="st-esg-card-head"><div><div class="st-esg-card-title">生成任务指令</div><div class="st-esg-card-desc">告诉插件“要补什么状态栏组件”。</div></div></div><textarea id="st-esg-task" class="text_pole textarea_compact st-esg-textarea" rows="7"></textarea></div></section>
        <section class="st-esg-tab-panel" data-tab-panel="api"><div class="st-esg-card"><div class="st-esg-card-head"><div><div class="st-esg-card-title">独立 API</div><div class="st-esg-card-desc">支持 OpenAI-compatible /v1/chat/completions。留空时只生成占位内容。</div></div></div><div class="st-esg-grid"><label>API 地址<input id="st-esg-api-url" class="text_pole" type="text" placeholder="例如 https://api.openai.com/v1" /></label><label>模型名称<input id="st-esg-api-model" class="text_pole" type="text" list="st-esg-model-options" placeholder="例如 gpt-4o-mini / deepseek-chat" /><datalist id="st-esg-model-options"></datalist></label><label>最大输出<input id="st-esg-max-tokens" class="text_pole" type="number" min="1" step="1" /></label><label>温度<input id="st-esg-temperature" class="text_pole" type="number" min="0" max="2" step="0.1" /></label></div><label class="st-esg-secret-label">API Key<input id="st-esg-api-key" class="text_pole" type="password" placeholder="可选。多数独立 API 需要填写。" /></label><div class="st-esg-actions-row"><div id="st-esg-fetch-models" class="menu_button menu_button_icon st-esg-secondary-action"><i class="fa-solid fa-cloud-arrow-down"></i><span>拉取模型</span></div></div></div></section>
        <section class="st-esg-tab-panel" data-tab-panel="sources"><div class="st-esg-card st-esg-import-tools"><div class="st-esg-card-head"><div><div id="st-esg-source-mode-title" class="st-esg-card-title">提示词模式</div><div id="st-esg-source-mode-desc" class="st-esg-card-desc">当前勾选会作为外置生成时启用的来源，不会导入组件库。</div></div></div><div class="st-esg-grid"><label>来源模式<select id="st-esg-source-mode" class="text_pole"><option value="prompt">提示词模式</option><option value="import">导入组件库模式</option></select></label><label>导入到<select id="st-esg-import-target-scope" class="text_pole"><option>全局</option><option>预设</option><option>角色</option></select></label></div><div class="st-esg-actions-row"><div id="st-esg-scan-components" class="menu_button menu_button_icon st-esg-secondary-action"><i class="fa-solid fa-list-check"></i><span>同步来源</span></div><div id="st-esg-import-components" class="menu_button menu_button_icon st-esg-secondary-action"><i class="fa-solid fa-file-import"></i><span>已自动保存勾选</span></div></div></div><div class="st-esg-card"><div class="st-esg-card-head"><div><div class="st-esg-card-title">预设</div><div class="st-esg-card-desc">用选择框切换预设；下方只显示当前选择的预设条目。</div></div></div><div class="st-esg-grid"><label>选择预设<select id="st-esg-source-preset" class="text_pole"></select></label></div><div id="st-esg-preset-candidates" class="st-esg-import-list"><div class="st-esg-empty st-esg-empty-small">还没有预设条目。选择预设后点击“同步来源”。</div></div></div><div class="st-esg-card"><div class="st-esg-card-head"><div><div class="st-esg-card-title">世界书</div><div class="st-esg-card-desc">这里是独立的世界书列表；点进某本世界书后只替换这张卡片。</div></div></div><div id="st-esg-worldbook-candidates" class="st-esg-import-list"><div class="st-esg-empty st-esg-empty-small">还没有世界书来源。点击“同步来源”后会按分类列出。</div></div></div></section>
        <section class="st-esg-tab-panel" data-tab-panel="components"><div class="st-esg-card"><div class="st-esg-card-head"><div><div class="st-esg-card-title">手动添加组件</div><div class="st-esg-card-desc">组件库只管理最终会发送的组件；从预设和世界书导入请去“预设/世界书”页。</div></div></div><div class="st-esg-grid"><label>组件名<input id="st-esg-component-name" class="text_pole" type="text" placeholder="例如：人物状态栏" /></label><label>归属<select id="st-esg-component-scope" class="text_pole"><option>全局</option><option>预设</option><option>角色</option></select></label></div><textarea id="st-esg-component-content" class="text_pole textarea_compact st-esg-textarea" rows="5" placeholder="在这里粘贴状态栏格式、要求或组件提示词。"></textarea><div class="st-esg-actions-row"><div id="st-esg-add-component" class="menu_button menu_button_icon st-esg-secondary-action"><i class="fa-solid fa-plus"></i><span>添加到组件库</span></div></div></div><div id="st-esg-component-list" class="st-esg-component-list"></div></section>
        <section class="st-esg-tab-panel" data-tab-panel="debug"><div class="st-esg-card"><div class="st-esg-card-head"><div><div class="st-esg-card-title">提示词日志</div><div class="st-esg-card-desc">这里记录最近一次发给独立 API 的 messages。不会保存 API Key。</div></div></div><textarea id="st-esg-prompt-log" class="text_pole textarea_compact st-esg-textarea st-esg-log" rows="16" readonly placeholder="生成一次状态栏后，这里会显示本次 API 请求提示词。"></textarea><div class="st-esg-actions-row"><div id="st-esg-copy-prompt-log" class="menu_button menu_button_icon st-esg-secondary-action"><i class="fa-solid fa-copy"></i><span>复制日志</span></div><div id="st-esg-clear-prompt-log" class="menu_button menu_button_icon st-esg-secondary-action"><i class="fa-solid fa-eraser"></i><span>清空日志</span></div></div></div></section>
        <section class="st-esg-tab-panel" data-tab-panel="output"><div class="st-esg-card"><div class="st-esg-card-head"><div><div class="st-esg-card-title">注入方式</div><div class="st-esg-card-desc">直接注入模型输出原文，不再添加插件自定义包裹标记。</div></div></div><select id="st-esg-inject-mode" class="text_pole st-esg-select"><option value="replace">清理旧版 ST 标记后追加</option><option value="append">始终追加到最新回复末尾</option></select></div><div class="st-esg-card"><div class="st-esg-card-head"><div><div class="st-esg-card-title">输出清理</div><div class="st-esg-card-desc">每行一个标签或包裹符，用于清理模型多余输出。</div></div></div><textarea id="st-esg-cleanup-tags" class="text_pole textarea_compact st-esg-textarea" rows="5" placeholder="例如：&#10;<status>&#10;</status>"></textarea></div><div class="st-esg-card st-esg-compact-card"><label class="st-esg-checkbox"><input id="st-esg-ball-visible" type="checkbox" /><span>显示可选悬浮快捷按钮</span></label></div></section>
      </div>
      <div class="st-esg-panel-footer"><div id="st-esg-status" class="st-esg-status-pill"><span class="st-esg-dot"></span><span>准备就绪</span></div><div class="st-esg-footer-actions"><div id="st-esg-generate" class="menu_button menu_button_icon st-esg-primary-action"><i class="fa-solid fa-sparkles"></i><span>生成状态栏</span></div><div id="st-esg-inject" class="menu_button menu_button_icon st-esg-secondary-action"><i class="fa-solid fa-file-import"></i><span>注入最新回复</span></div></div></div>
    </div>`;
  targetDoc.body.appendChild(dialog);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); togglePanel(false); });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) togglePanel(false); });
  bindPanelEvents();
}

function bindPanelEvents() {
  $t('#st-esg-enabled').prop('checked', settings.enabled);
  $t('#st-esg-ball-visible').prop('checked', settings.ballVisible);
  $t('#st-esg-mode').val(settings.mode);
  $t('#st-esg-task').val(settings.taskPrompt);
  $t('#st-esg-preview').val(settings.lastGenerated);
  $t('#st-esg-prompt-log').val(settings.lastPromptLog || '');
  $t('#st-esg-api-url').val(settings.apiUrl);
  $t('#st-esg-api-key').val(settings.apiKey);
  $t('#st-esg-api-model').val(settings.apiModel);
  renderModelOptions();
  $t('#st-esg-max-tokens').val(settings.maxTokens);
  $t('#st-esg-temperature').val(settings.temperature);
  $t('#st-esg-inject-mode').val(settings.injectMode);
  $t('#st-esg-cleanup-tags').val(settings.cleanupTags);
  renderSourceModeUi();
  renderSourcePresetSelect();
  renderComponentList(); switchTab(settings.activeTab || 'workspace');
  $t('#st-esg-close').on('click', () => togglePanel(false));
  $t('.st-esg-tab').on('click', function () { switchTab(String($(this).data('tab'))); });
  $t('#st-esg-add-component').on('click', addComponent);
  $t('#st-esg-source-mode').on('change', function () {
    settings.sourceMode = String($(this).val()) === SOURCE_MODE_IMPORT ? SOURCE_MODE_IMPORT : SOURCE_MODE_PROMPT;
    saveSettings();
    renderSourceModeUi();
    renderImportCandidates();
  });
  $t('#st-esg-source-preset').on('change', function () { settings.activeSourcePreset = String($(this).val() || ''); saveSettings(); scanImportCandidates(); });
  $t('#st-esg-scan-components').on('click', scanImportCandidates);
  $t('#st-esg-import-components').on('click', importCheckedCandidates);
  $t('#st-esg-copy-prompt-log').on('click', async () => {
    const copied = await copyTextToClipboard(settings.lastPromptLog || $t('#st-esg-prompt-log').val());
    setStatus(copied ? '已复制提示词日志。' : '已选中提示词日志，可以手动复制。');
  });
  $t('#st-esg-clear-prompt-log').on('click', () => {
    settings.lastPromptLog = '';
    $t('#st-esg-prompt-log').val('');
    saveSettings();
    setStatus('已清空提示词日志。');
  });
  $t('#st-esg-fetch-models').on('click', fetchApiModels);
  $t('#st-esg-enabled').on('change', function () { settings.enabled = Boolean($(this).prop('checked')); saveSettings(); });
  $t('#st-esg-ball-visible').on('change', function () { settings.ballVisible = Boolean($(this).prop('checked')); saveSettings(); renderFloatingBall(); });
  $t('#st-esg-mode').on('change', function () { settings.mode = String($(this).val()); saveSettings(); });
  $t('#st-esg-task').on('input', function () { settings.taskPrompt = String($(this).val()); saveSettings(); });
  $t('#st-esg-preview').on('input', function () { settings.lastGenerated = String($(this).val()); saveSettings(); });
  $t('#st-esg-api-url').on('input', function () { settings.apiUrl = String($(this).val()); saveSettings(); });
  $t('#st-esg-api-key').on('input', function () { settings.apiKey = String($(this).val()); saveSettings(); });
  $t('#st-esg-api-model').on('input', function () { settings.apiModel = String($(this).val()); saveSettings(); });
  $t('#st-esg-max-tokens').on('input', function () { settings.maxTokens = String($(this).val()); saveSettings(); });
  $t('#st-esg-temperature').on('input', function () { settings.temperature = String($(this).val()); saveSettings(); });
  $t('#st-esg-inject-mode').on('change', function () { settings.injectMode = String($(this).val()); saveSettings(); });
  $t('#st-esg-cleanup-tags').on('input', function () { settings.cleanupTags = String($(this).val()); saveSettings(); });
  $t('#st-esg-generate').on('click', generateStatusbar);
  $t('#st-esg-inject').on('click', injectGeneratedStatusbar);
}

function mountUi() {
  if (!targetDoc.body) { targetWindow.setTimeout(mountUi, 500); return; }
  renderMagicWandMenuButton(); renderFloatingBall(); renderPluginPanel();
}

function loadStylesheet() {
  if (targetDoc.getElementById(`${EXTENSION_ID}-style`)) return;
  const link = targetDoc.createElement('link');
  link.id = `${EXTENSION_ID}-style`;
  link.rel = 'stylesheet';
  link.href = new URL(`./style.css?ver=${EXTENSION_VERSION}`, import.meta.url).href;
  targetDoc.head.appendChild(link);
}

function init() {
  if (initialized) return;
  initialized = true;
  loadSettings(); loadStylesheet(); mountUi();
  const context = getContext();
  context.eventSource.on(context.eventTypes.GENERATION_ENDED, handleGenerationEnded);
  console.log(`[${EXTENSION_ID}] 已加载，dialog top layer，UI 挂载文档：${targetWindow === window ? 'current' : 'parent'}`);
}

init();
