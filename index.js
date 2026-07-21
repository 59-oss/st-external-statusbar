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
  getComponentBindingName,
  getCurrentPresetNameSafe,
  getPresetNamesSafe,
  normalizeComponent,
} from './component-sources.js';

const EXTENSION_ID = 'st-external-statusbar';
const EXTENSION_VERSION = '0.3.14';
const START = '<!-- ST-STATUSBAR-START -->';
const END = '<!-- ST-STATUSBAR-END -->';
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
  maxTokens: '800',
  temperature: '0.7',
  injectMode: 'replace',
  cleanupTags: '',
  lastGenerated: '',
  ballX: 16,
  ballY: 16,
  ballVisible: false,
  activeSourcePreset: '',
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

function getRecentChatText(chat, limit = 8) {
  return chat.slice(-limit).map((item) => `${item?.is_user ? '用户' : '助手'}：${item?.mes || ''}`).join('\n\n');
}

function getEnabledComponents() {
  return getActiveComponentsForContext(settings.components, targetWindow, getContext());
}

function cleanGeneratedText(text) {
  const tags = String(settings.cleanupTags || '').split('\n').map((item) => item.trim()).filter(Boolean);
  return tags.reduce((current, tag) => current.split(tag).join(''), String(text || '')).trim();
}

function buildMessages(latestMessage) {
  const context = getContext();
  const components = getEnabledComponents();
  const componentText = components.length
    ? components.map((item, index) => `【组件 ${index + 1}｜${item.scope || '全局'}｜${item.name || '未命名'}】\n${item.content || ''}`).join('\n\n')
    : '当前没有启用的组件。请根据生成任务指令输出状态栏。';
  return [
    { role: 'system', content: ['你是 SillyTavern 的外置文末状态栏生成器。', '你只生成文末状态栏/文末组件，不续写正文，不解释，不输出分析过程。', '输出必须尽量贴合最近正文的语言、氛围、角色状态与叙事风格。'].join('\n') },
    { role: 'user', content: [`生成任务：${settings.taskPrompt}`, '', '启用组件：', componentText, '', '最近聊天记录：', getRecentChatText(context.chat), '', '最新助手回复：', latestMessage.mes, '', '请现在只输出需要追加在正文末尾的状态栏内容。'].join('\n') },
  ];
}

function normalizeApiUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${trimmed.replace(/\/$/, '')}/chat/completions`;
}

async function callExternalApi(latestMessage) {
  const apiUrl = normalizeApiUrl(settings.apiUrl);
  const model = textOf(settings.apiModel);
  if (!apiUrl || !model) throw new Error('请先在“API 设置”里填写 API 地址和模型名称。');
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) },
    body: JSON.stringify({ model, messages: buildMessages(latestMessage), max_tokens: Number(settings.maxTokens) || 800, temperature: Number(settings.temperature) || 0.7 }),
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
  const block = `${START}\n${text}\n${END}`;
  const hasOldBlock = message.mes.includes(START) && message.mes.includes(END);
  message.mes = settings.injectMode === 'replace' && hasOldBlock
    ? message.mes.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block)
    : `${message.mes}\n\n${block}`.trim();
}

async function generateStatusbar() {
  const context = getContext();
  const latest = getLatestAssistantMessage(context.chat);
  if (!latest) { setStatus('没有找到可用于生成的助手回复。'); return ''; }
  setStatus('正在生成状态栏……');
  let result = '';
  try { result = settings.apiUrl ? await callExternalApi(latest.message) : buildFallbackStatusbar(latest.message); }
  catch (error) { setStatus(error?.message || '生成失败。'); return ''; }
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

function switchTab(tabName) {
  const nextTab = tabName || 'workspace';
  $t('.st-esg-tab').removeClass('active');
  $t(`.st-esg-tab[data-tab="${nextTab}"]`).addClass('active');
  $t('.st-esg-tab-panel').removeClass('active');
  $t(`.st-esg-tab-panel[data-tab-panel="${nextTab}"]`).addClass('active');
  settings.activeTab = nextTab;
  saveSettings();
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
    const items = settings.components.map((item, index) => ({ ...item, index })).filter((item) => item.scope === section.scope);
    return `<details class="st-esg-component-section" open><summary class="st-esg-component-section-head"><div><div class="st-esg-import-group-title">${section.title}</div><div class="st-esg-card-desc">${section.desc}</div></div><em>${items.length} 个</em></summary><div class="st-esg-component-section-body">${items.length ? items.map((item) => `<details class="st-esg-component-item" data-index="${item.index}"><summary class="st-esg-component-item-head"><label class="st-esg-checkbox"><input class="st-esg-component-enabled" type="checkbox" ${item.enabled === false ? '' : 'checked'} /><span>${escapeHtml(item.name || '未命名组件')}</span></label>${item.bindName ? `<em>${escapeHtml(item.bindName)}</em>` : ''}<button class="menu_button st-esg-component-delete" type="button">删除</button></summary><div class="st-esg-component-preview" data-loaded="false"></div></details>`).join('') : '<div class="st-esg-empty st-esg-empty-small">暂无组件</div>'}</div></details>`;
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
  settings.components.push({ id: String(Date.now()), name: name || '未命名组件', scope, bindName: getComponentBindingName(scope, targetWindow, getContext()), content, enabled: true, sourceType: '手动' });
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

function captureImportViewState() {
  const box = $t('#st-esg-import-candidates');
  const panelBody = $t('#st-esg-dialog .st-esg-panel-body');
  return {
    listScrollTop: box.length ? box.scrollTop() : 0,
    panelScrollTop: panelBody.length ? panelBody.scrollTop() : 0,
    openGroups: new Set($t('.st-esg-import-group[open]').toArray().map((node) => Number($(node).data('group-index')))),
  };
}

function restoreImportViewState(state) {
  if (!state) return;
  const box = $t('#st-esg-import-candidates');
  const panelBody = $t('#st-esg-dialog .st-esg-panel-body');
  if (box.length) box.scrollTop(state.listScrollTop || 0);
  if (panelBody.length) panelBody.scrollTop(state.panelScrollTop || 0);
}

function renderSourcePresetSelect() {
  const select = $t('#st-esg-source-preset');
  if (!select.length) return;
  const names = getPresetNamesSafe(targetWindow, getContext());
  const current = settings.activeSourcePreset || getCurrentPresetNameSafe(targetWindow, getContext()) || names[0] || '';
  if (!settings.activeSourcePreset && current) settings.activeSourcePreset = current;
  select.html(names.map((name) => `<option value="${escapeHtml(name)}" ${name === current ? 'selected' : ''}>${escapeHtml(name)}</option>`).join(''));
}

async function scanImportCandidates() {
  const context = getContext();
  const selectedWorldNames = $t('#world_info').val() || [];
  settings.activeSourcePreset = textOf($t('#st-esg-source-preset').val()) || settings.activeSourcePreset || getCurrentPresetNameSafe(targetWindow, context);
  saveSettings();
  importGroups = [
    ...collectPresetImportGroups({ targetWindow, context, presetName: settings.activeSourcePreset }),
    ...collectWorldbookImportGroups({ targetWindow, context, selectedWorldNames }),
  ];
  importCandidates = importGroups.flatMap((group) => group.items || []);
  renderImportCandidates();
  setStatus(`已列出 ${importGroups.length} 个来源。世界书会在展开时加载。`);
}

async function loadImportGroup(groupIndex) {
  const group = importGroups[groupIndex];
  if (!group || group.loaded || group.loading || group.scope !== SOURCE_WORLDBOOK) return;
  group.uiOpen = true;
  group.loading = true;
  renderImportCandidates();
  try {
    group.items = await collectWorldbookImportCandidates(targetWindow, group.source);
    group.loaded = true;
    setStatus(`已加载 ${group.source}：${group.items.length} 个条目。`);
  } catch (error) {
    group.error = error?.message || '加载失败';
    setStatus(`加载 ${group.source} 失败。`);
  } finally {
    group.loading = false;
    importCandidates = importGroups.flatMap((item) => item.items || []);
    renderImportCandidates();
  }
}

function renderImportCandidates() {
  const box = $t('#st-esg-import-candidates');
  if (!box.length) return;
  if (!importGroups.length) { box.html('<div class="st-esg-empty">还没有来源。选择预设后点击“同步来源”，会显示该预设条目和世界书分类。</div>'); return; }
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
    if (group.loading) return '<div class="st-esg-empty st-esg-empty-small">正在加载这本世界书...</div>';
    if (group.error) return `<div class="st-esg-empty st-esg-empty-small">${escapeHtml(group.error)}</div>`;
    if (!group.loaded) return '<div class="st-esg-empty st-esg-empty-small">展开后才加载条目，避免刷新卡顿。</div>';
    if (!group.items.length) return '<div class="st-esg-empty st-esg-empty-small">没有可导入条目</div>';
    return group.items.map((item, itemIndex) => {
      const sourceEnabled = item.enabled !== false;
      return `<div class="st-esg-import-item" data-group-index="${group.groupIndex}" data-item-index="${itemIndex}"><label class="st-esg-checkbox"><input class="st-esg-import-check" type="checkbox" ${sourceEnabled ? 'checked' : ''} /><span>${escapeHtml(item.name)}</span></label><em>${sourceEnabled ? '酒馆已启用' : '酒馆未启用'}</em></div>`;
    }).join('');
  };
  const renderGroup = (group) => {
    const shouldOpen = group.uiOpen || viewState.openGroups.has(group.groupIndex) || (group.loaded && group.scope !== SOURCE_WORLDBOOK);
    return `<details class="st-esg-import-group" data-group-index="${group.groupIndex}" ${shouldOpen ? 'open' : ''}><summary class="st-esg-import-group-head"><div><div class="st-esg-import-group-title">${escapeHtml(group.group)}</div><div class="st-esg-card-desc">${group.loaded ? `${group.items.length} 个可导入条目` : '未加载，点开读取'}</div></div>${group.loaded ? '<button class="menu_button st-esg-import-group-toggle" type="button">本组全选</button>' : ''}</summary><div class="st-esg-import-group-list">${groupBody(group)}</div></details>`;
  };
  const presetSection = presetGroups.length ? `<details class="st-esg-import-scope" open><summary class="st-esg-import-scope-summary"><span>预设</span><em>${countItems(presetGroups)} 个已加载条目</em></summary><div class="st-esg-import-scope-body">${presetGroups.map(renderGroup).join('')}</div></details>` : '';
  const worldbookCategoryHtml = [...worldbookCategories.values()]
    .filter((category) => category.groups.length)
    .map((category) => `<details class="st-esg-import-category" open><summary class="st-esg-import-category-summary"><span>${escapeHtml(category.categoryLabel)}</span><em>${category.groups.length} 本</em></summary><div class="st-esg-import-category-body">${category.groups.map(renderGroup).join('')}</div></details>`)
    .join('');
  const worldbookSection = worldbookGroups.length ? `<details class="st-esg-import-scope" open><summary class="st-esg-import-scope-summary"><span>世界书</span><em>${worldbookGroups.length} 本来源</em></summary><div class="st-esg-import-scope-body">${worldbookCategoryHtml}</div></details>` : '';
  box.html(`${presetSection}${worldbookSection}` || '<div class="st-esg-empty">没有可用来源。</div>');
  restoreImportViewState(viewState);
  $t('.st-esg-import-group').on('toggle', function () {
    const groupIndex = Number($(this).data('group-index'));
    if (importGroups[groupIndex]) importGroups[groupIndex].uiOpen = this.open;
    if (this.open) loadImportGroup(groupIndex);
  });
  $t('.st-esg-import-check').on('click', (event) => event.stopPropagation());
  $t('.st-esg-import-group-toggle').on('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
    const checks = $(this).closest('.st-esg-import-group').find('.st-esg-import-check');
    const shouldCheck = checks.toArray().some((item) => !$(item).prop('checked'));
    checks.prop('checked', shouldCheck);
    $(this).text(shouldCheck ? '取消本组' : '本组全选');
  });
}

function importCheckedCandidates() {
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
    if (existingIndex >= 0) {
      settings.components[existingIndex] = { ...settings.components[existingIndex], name: item.name, scope: targetScope, bindName, content: item.content, enabled: true, source: item.source, sourceType: item.scope };
      updated += 1;
    } else {
      settings.components.push({ id: String(Date.now() + Math.random()), name: item.name, scope: targetScope, bindName, content: item.content, enabled: true, source: item.source, sourceType: item.scope });
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
        <nav class="st-esg-tabs" aria-label="外置状态栏生成器分页"><button class="st-esg-tab" type="button" data-tab="workspace"><i class="fa-solid fa-sparkles"></i><span>生成结果</span></button><button class="st-esg-tab" type="button" data-tab="runtime"><i class="fa-solid fa-sliders"></i><span>运行设置</span></button><button class="st-esg-tab" type="button" data-tab="api"><i class="fa-solid fa-plug"></i><span>API 设置</span></button><button class="st-esg-tab" type="button" data-tab="sources"><i class="fa-solid fa-book-open"></i><span>预设/世界书</span></button><button class="st-esg-tab" type="button" data-tab="components"><i class="fa-solid fa-layer-group"></i><span>组件库</span></button><button class="st-esg-tab" type="button" data-tab="output"><i class="fa-solid fa-code"></i><span>输出注入</span></button></nav>
        <section class="st-esg-tab-panel" data-tab-panel="workspace"><div class="st-esg-card"><div class="st-esg-card-head"><div><div class="st-esg-card-title">生成内容</div><div class="st-esg-card-desc">这里是状态栏生成结果。你可以先检查，再注入最新回复。</div></div></div><textarea id="st-esg-preview" class="text_pole textarea_compact st-esg-textarea st-esg-preview" rows="11" placeholder="生成后的状态栏会出现在这里。"></textarea></div><div class="st-esg-workflow"><div class="st-esg-step"><b>1</b><span>读取最新助手回复</span></div><div class="st-esg-step"><b>2</b><span>按组件与任务生成</span></div><div class="st-esg-step"><b>3</b><span>预览后写回正文末尾</span></div></div></section>
        <section class="st-esg-tab-panel" data-tab-panel="runtime"><div class="st-esg-card"><div class="st-esg-card-head"><div><div class="st-esg-card-title">运行模式</div><div class="st-esg-card-desc">控制插件是否监听正文生成，以及生成后是否自动注入。</div></div><label class="st-esg-switch"><input id="st-esg-enabled" type="checkbox" /><span></span><em>启用</em></label></div><select id="st-esg-mode" class="text_pole st-esg-select"><option value="autoInject">自动生成，并自动注入最新回复</option><option value="autoReview">自动生成，但手动确认注入</option><option value="manual">手动点击生成，手动注入</option></select></div><div class="st-esg-card"><div class="st-esg-card-head"><div><div class="st-esg-card-title">生成任务指令</div><div class="st-esg-card-desc">告诉插件“要补什么状态栏组件”。</div></div></div><textarea id="st-esg-task" class="text_pole textarea_compact st-esg-textarea" rows="7"></textarea></div></section>
        <section class="st-esg-tab-panel" data-tab-panel="api"><div class="st-esg-card"><div class="st-esg-card-head"><div><div class="st-esg-card-title">独立 API</div><div class="st-esg-card-desc">支持 OpenAI-compatible /v1/chat/completions。留空时只生成占位内容。</div></div></div><div class="st-esg-grid"><label>API 地址<input id="st-esg-api-url" class="text_pole" type="text" placeholder="例如 https://api.openai.com/v1" /></label><label>模型名称<input id="st-esg-api-model" class="text_pole" type="text" placeholder="例如 gpt-4o-mini / deepseek-chat" /></label><label>最大输出<input id="st-esg-max-tokens" class="text_pole" type="number" min="1" step="1" /></label><label>温度<input id="st-esg-temperature" class="text_pole" type="number" min="0" max="2" step="0.1" /></label></div><label class="st-esg-secret-label">API Key<input id="st-esg-api-key" class="text_pole" type="password" placeholder="可选。多数独立 API 需要填写。" /></label></div></section>
        <section class="st-esg-tab-panel" data-tab-panel="sources"><div class="st-esg-card st-esg-import-tools"><div class="st-esg-card-head"><div><div class="st-esg-card-title">导入操作</div><div class="st-esg-card-desc">勾选预设或世界书条目后，选择归属并导入组件库。</div></div></div><div class="st-esg-grid"><label>导入到<select id="st-esg-import-target-scope" class="text_pole"><option>全局</option><option>预设</option><option>角色</option></select></label></div><div class="st-esg-actions-row"><div id="st-esg-scan-components" class="menu_button menu_button_icon st-esg-secondary-action"><i class="fa-solid fa-list-check"></i><span>同步来源</span></div><div id="st-esg-import-components" class="menu_button menu_button_icon st-esg-secondary-action"><i class="fa-solid fa-file-import"></i><span>导入勾选条目</span></div></div></div><div class="st-esg-card"><div class="st-esg-card-head"><div><div class="st-esg-card-title">预设</div><div class="st-esg-card-desc">用选择框切换预设；下方只显示当前选择的预设条目。</div></div></div><div class="st-esg-grid"><label>选择预设<select id="st-esg-source-preset" class="text_pole"></select></label></div></div><div id="st-esg-import-candidates" class="st-esg-import-list"><div class="st-esg-empty">还没有来源。选择预设后点击“同步来源”，会显示该预设条目和全部世界书分类。</div></div></section>
        <section class="st-esg-tab-panel" data-tab-panel="components"><div class="st-esg-card"><div class="st-esg-card-head"><div><div class="st-esg-card-title">手动添加组件</div><div class="st-esg-card-desc">组件库只管理最终会发送的组件；从预设和世界书导入请去“预设/世界书”页。</div></div></div><div class="st-esg-grid"><label>组件名<input id="st-esg-component-name" class="text_pole" type="text" placeholder="例如：人物状态栏" /></label><label>归属<select id="st-esg-component-scope" class="text_pole"><option>全局</option><option>预设</option><option>角色</option></select></label></div><textarea id="st-esg-component-content" class="text_pole textarea_compact st-esg-textarea" rows="5" placeholder="在这里粘贴状态栏格式、要求或组件提示词。"></textarea><div class="st-esg-actions-row"><div id="st-esg-add-component" class="menu_button menu_button_icon st-esg-secondary-action"><i class="fa-solid fa-plus"></i><span>添加到组件库</span></div></div></div><div id="st-esg-component-list" class="st-esg-component-list"></div></section>
        <section class="st-esg-tab-panel" data-tab-panel="output"><div class="st-esg-card"><div class="st-esg-card-head"><div><div class="st-esg-card-title">注入方式</div><div class="st-esg-card-desc">决定每次注入是替换旧状态栏，还是追加到正文末尾。</div></div></div><select id="st-esg-inject-mode" class="text_pole st-esg-select"><option value="replace">同名标记存在时替换，否则追加</option><option value="append">始终追加到最新回复末尾</option></select></div><div class="st-esg-card"><div class="st-esg-card-head"><div><div class="st-esg-card-title">输出清理</div><div class="st-esg-card-desc">每行一个标签或包裹符，用于清理模型多余输出。</div></div></div><textarea id="st-esg-cleanup-tags" class="text_pole textarea_compact st-esg-textarea" rows="5" placeholder="例如：&#10;<status>&#10;</status>"></textarea></div><div class="st-esg-card st-esg-compact-card"><label class="st-esg-checkbox"><input id="st-esg-ball-visible" type="checkbox" /><span>显示可选悬浮快捷按钮</span></label></div></section>
      </div>
      <div class="st-esg-panel-footer"><div id="st-esg-generate" class="menu_button menu_button_icon st-esg-primary-action"><i class="fa-solid fa-sparkles"></i><span>生成状态栏</span></div><div id="st-esg-inject" class="menu_button menu_button_icon st-esg-secondary-action"><i class="fa-solid fa-file-import"></i><span>注入最新回复</span></div></div>
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
  $t('#st-esg-api-url').val(settings.apiUrl);
  $t('#st-esg-api-key').val(settings.apiKey);
  $t('#st-esg-api-model').val(settings.apiModel);
  $t('#st-esg-max-tokens').val(settings.maxTokens);
  $t('#st-esg-temperature').val(settings.temperature);
  $t('#st-esg-inject-mode').val(settings.injectMode);
  $t('#st-esg-cleanup-tags').val(settings.cleanupTags);
  renderSourcePresetSelect();
  renderComponentList(); switchTab(settings.activeTab || 'workspace');
  $t('#st-esg-close').on('click', () => togglePanel(false));
  $t('.st-esg-tab').on('click', function () { switchTab(String($(this).data('tab'))); });
  $t('#st-esg-add-component').on('click', addComponent);
  $t('#st-esg-source-preset').on('change', function () { settings.activeSourcePreset = String($(this).val() || ''); saveSettings(); scanImportCandidates(); });
  $t('#st-esg-scan-components').on('click', scanImportCandidates);
  $t('#st-esg-import-components').on('click', importCheckedCandidates);
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
