import { getContext } from '../../../st-context.js';

const EXTENSION_ID = 'st-external-statusbar';
const EXTENSION_VERSION = '0.2.9';
const START = '<!-- ST-STATUSBAR-START -->';
const END = '<!-- ST-STATUSBAR-END -->';

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
  components: [],
};

let initialized = false;
let settings = { ...DEFAULT_SETTINGS };
let importCandidates = [];

function getSettingsStore() {
  const context = getContext();
  context.extensionSettings[EXTENSION_ID] ??= {};
  return context.extensionSettings[EXTENSION_ID];
}

function loadSettings() {
  settings = Object.assign({ ...DEFAULT_SETTINGS }, getSettingsStore());
  if (!Array.isArray(settings.components)) settings.components = [];
}

function saveSettings() {
  Object.assign(getSettingsStore(), settings);
  getContext().saveSettingsDebounced();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function textOf(value) {
  return String(value ?? '').trim();
}

function addCandidate(candidates, source, scope, name, content) {
  const clean = textOf(content);
  if (!clean) return;
  const key = `${source}::${scope}::${name}::${clean.slice(0, 200)}`;
  if (candidates.some((item) => item.key === key)) return;
  candidates.push({ key, source, scope, group: source, name: name || '未命名候选', content: clean });
}

function addStructuredCandidate(candidates, group, source, scope, name, content, meta = '') {
  const clean = textOf(content);
  if (!clean) return;
  const key = `${group}::${source}::${scope}::${name}::${clean.slice(0, 200)}`;
  if (candidates.some((item) => item.key === key)) return;
  candidates.push({ key, group, source, scope, name: name || '未命名条目', content: clean, meta });
}

function getLatestAssistantMessage(chat) {
  for (let i = chat.length - 1; i >= 0; i -= 1) {
    const item = chat[i];
    if (item?.is_user) continue;
    if (item?.mes) return { index: i, message: item };
  }
  return null;
}

function getRecentChatText(chat, limit = 8) {
  return chat.slice(-limit).map((item) => {
    const role = item?.is_user ? '用户' : '助手';
    return `${role}：${item?.mes || ''}`;
  }).join('\n\n');
}

function getEnabledComponents() {
  return settings.components.filter((item) => item?.enabled !== false);
}

function cleanGeneratedText(text) {
  const tags = String(settings.cleanupTags || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
  return tags.reduce((current, tag) => current.split(tag).join(''), String(text || '')).trim();
}

function buildMessages(latestMessage) {
  const context = getContext();
  const components = getEnabledComponents();
  const componentText = components.length
    ? components.map((item, index) => `【组件 ${index + 1}｜${item.scope || '全局'}｜${item.name || '未命名'}】\n${item.content || ''}`).join('\n\n')
    : '当前没有启用的组件。请根据生成任务指令输出状态栏。';

  return [
    {
      role: 'system',
      content: [
        '你是 SillyTavern 的外置文末状态栏生成器。',
        '你只生成文末状态栏/文末组件，不续写正文，不解释，不输出分析过程。',
        '输出必须尽量贴合最近正文的语言、氛围、角色状态与叙事风格。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `生成任务：${settings.taskPrompt}`,
        '',
        '启用组件：',
        componentText,
        '',
        '最近聊天记录：',
        getRecentChatText(context.chat),
        '',
        '最新助手回复：',
        latestMessage.mes,
        '',
        '请现在只输出需要追加在正文末尾的状态栏内容。',
      ].join('\n'),
    },
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
    headers: {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: buildMessages(latestMessage),
      max_tokens: Number(settings.maxTokens) || 800,
      temperature: Number(settings.temperature) || 0.7,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`API 请求失败：${response.status} ${errorText.slice(0, 160)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
  if (!content.trim()) throw new Error('API 返回为空。');
  return cleanGeneratedText(content);
}

function buildFallbackStatusbar(latestMessage) {
  return cleanGeneratedText([
    '[外置状态栏生成器]',
    `任务：${settings.taskPrompt}`,
    '状态：尚未配置独立 API，因此这里是本地占位输出。',
    `启用组件数：${getEnabledComponents().length}`,
    `最新助手回复长度：${latestMessage.mes.length} 个字符`,
  ].join('\n'));
}

function injectStatusbar(message, text) {
  const block = `${START}\n${text}\n${END}`;
  const hasOldBlock = message.mes.includes(START) && message.mes.includes(END);
  if (settings.injectMode === 'replace' && hasOldBlock) {
    message.mes = message.mes.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
  } else {
    message.mes = `${message.mes}\n\n${block}`.trim();
  }
}

async function generateStatusbar() {
  const context = getContext();
  const latest = getLatestAssistantMessage(context.chat);
  if (!latest) {
    setStatus('没有找到可用于生成的助手回复。');
    return '';
  }

  setStatus('正在生成状态栏……');
  let result = '';
  try {
    result = settings.apiUrl ? await callExternalApi(latest.message) : buildFallbackStatusbar(latest.message);
  } catch (error) {
    setStatus(error?.message || '生成失败。');
    return '';
  }

  settings.lastGenerated = result;
  saveSettings();
  $('#st-esg-preview').val(result);
  switchTab('workspace');
  setStatus('已生成状态栏内容，等待检查或注入。');
  return result;
}

async function injectGeneratedStatusbar() {
  const context = getContext();
  const latest = getLatestAssistantMessage(context.chat);
  if (!latest) {
    setStatus('没有找到可注入的助手回复。');
    return;
  }

  const text = settings.lastGenerated || $('#st-esg-preview').val() || await generateStatusbar();
  if (!text) return;

  injectStatusbar(latest.message, cleanGeneratedText(text));

  if (Array.isArray(latest.message.swipes) && Number.isInteger(latest.message.swipe_id)) {
    latest.message.swipes[latest.message.swipe_id] = latest.message.mes;
  }

  context.updateMessageBlock(latest.index, latest.message);
  await context.saveChat();
  setStatus('已注入到最新助手回复。');
}

async function handleGenerationEnded() {
  if (!settings.enabled || settings.mode === 'manual') return;
  const result = await generateStatusbar();
  if (settings.mode === 'autoInject' && result) await injectGeneratedStatusbar();
}

function setStatus(text) {
  $('#st-esg-status').text(text);
}

function switchTab(tabName) {
  const nextTab = tabName || 'workspace';
  $('.st-esg-tab').removeClass('active');
  $(`.st-esg-tab[data-tab="${nextTab}"]`).addClass('active');
  $('.st-esg-tab-panel').removeClass('active');
  $(`.st-esg-tab-panel[data-tab-panel="${nextTab}"]`).addClass('active');
  settings.activeTab = nextTab;
  saveSettings();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function togglePanel(forceOpen) {
  const panel = $('#st-external-statusbar-panel');
  if (!panel.length) return;
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : panel.hasClass('st-esg-panel-hidden');
  if (shouldOpen) {
    document.body.appendChild(panel[0]);
    panel.css({
      position: 'fixed',
      inset: '0',
      display: 'flex',
      zIndex: '2147483647',
    });
  }
  panel.toggleClass('st-esg-panel-hidden', !shouldOpen);
  $('#st-esg-menu-button').toggleClass('selected', shouldOpen);
  $('#st-esg-ball').toggleClass('selected', shouldOpen);
}

function renderMagicWandMenuButton(retry = 0) {
  if ($('#st-esg-menu-button').length) return;
  if (retry > 30) return;

  const menu = document.getElementById('extensions_menu') || document.getElementById('extensionsMenu');
  if (!menu) {
    window.setTimeout(() => renderMagicWandMenuButton(retry + 1), 500);
    return;
  }

  const button = document.createElement('div');
  button.id = 'st-esg-menu-button';
  button.className = 'list-group-item flex-container flexGap5 interactable';
  button.tabIndex = 0;
  button.title = '外置状态栏生成器';
  button.innerHTML = '<span><i class="fa-solid fa-wand-magic-sparkles"></i></span><span>状态栏生成器</span>';
  button.addEventListener('click', () => togglePanel(true));
  menu.prepend(button);
}

function renderFloatingBall() {
  if (!settings.ballVisible) {
    $('#st-esg-ball').remove();
    return;
  }
  if ($('#st-esg-ball').length) return;

  const ball = $(`<button id="st-esg-ball" type="button" title="外置状态栏生成器"><i class="fa-solid fa-wand-magic-sparkles"></i></button>`);
  ball.css({ left: `${settings.ballX ?? 16}px`, bottom: `${settings.ballY ?? 16}px` });
  $('body').append(ball);

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let originLeft = settings.ballX ?? 16;
  let originBottom = settings.ballY ?? 16;

  const onMove = (event) => {
    if (!dragging) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    ball.css({
      left: `${clamp(originLeft + dx, 0, window.innerWidth - 46)}px`,
      bottom: `${clamp(originBottom - dy, 0, window.innerHeight - 46)}px`,
    });
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    settings.ballX = parseFloat(ball.css('left')) || 16;
    settings.ballY = parseFloat(ball.css('bottom')) || 16;
    saveSettings();
    if (!moved) togglePanel();
  };

  ball.on('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    originLeft = parseFloat(ball.css('left')) || 16;
    originBottom = parseFloat(ball.css('bottom')) || 16;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function renderComponentList() {
  const list = $('#st-esg-component-list');
  if (!list.length) return;
  if (!settings.components.length) {
    list.html('<div class="st-esg-empty">还没有组件。可以手动添加，也可以点“刷新可选来源”，从预设、世界书或角色卡条目里勾选导入。</div>');
    return;
  }

  list.html(settings.components.map((item, index) => `
    <div class="st-esg-component-item" data-index="${index}">
      <label class="st-esg-checkbox">
        <input class="st-esg-component-enabled" type="checkbox" ${item.enabled === false ? '' : 'checked'} />
        <span>${escapeHtml(item.name || '未命名组件')} · ${escapeHtml(item.scope || '全局')}</span>
      </label>
      <button class="menu_button st-esg-component-delete" type="button">删除</button>
      <pre>${escapeHtml(item.content || '')}</pre>
    </div>
  `).join(''));

  $('.st-esg-component-enabled').on('change', function () {
    const index = Number($(this).closest('.st-esg-component-item').data('index'));
    settings.components[index].enabled = Boolean($(this).prop('checked'));
    saveSettings();
  });

  $('.st-esg-component-delete').on('click', function () {
    const index = Number($(this).closest('.st-esg-component-item').data('index'));
    settings.components.splice(index, 1);
    saveSettings();
    renderComponentList();
  });
}

function addComponent() {
  const name = textOf($('#st-esg-component-name').val());
  const scope = textOf($('#st-esg-component-scope').val()) || '全局';
  const content = textOf($('#st-esg-component-content').val());
  if (!content) {
    setStatus('组件内容不能为空。');
    return;
  }
  settings.components.push({ id: String(Date.now()), name: name || '未命名组件', scope, content, enabled: true });
  $('#st-esg-component-name').val('');
  $('#st-esg-component-content').val('');
  saveSettings();
  renderComponentList();
  setStatus('已添加组件。');
}

async function scanImportCandidates() {
  const context = getContext();
  const candidates = [];
  const currentChar = context.characters?.[context.characterId];
  const charData = currentChar?.data || currentChar;

  addStructuredCandidate(candidates, '角色卡', currentChar?.name || '当前角色', '角色', '角色描述', charData?.description || currentChar?.description);
  addStructuredCandidate(candidates, '角色卡', currentChar?.name || '当前角色', '角色', '性格', charData?.personality || currentChar?.personality);
  addStructuredCandidate(candidates, '角色卡', currentChar?.name || '当前角色', '角色', '场景', charData?.scenario || currentChar?.scenario);
  addStructuredCandidate(candidates, '角色卡', currentChar?.name || '当前角色', '角色', '开场白', charData?.first_mes || currentChar?.first_mes);
  addStructuredCandidate(candidates, '角色卡', currentChar?.name || '当前角色', '角色', '示例对话', charData?.mes_example || currentChar?.mes_example);
  addStructuredCandidate(candidates, '角色卡', currentChar?.name || '当前角色', '角色', '角色系统提示词', charData?.system_prompt);
  addStructuredCandidate(candidates, '角色卡', currentChar?.name || '当前角色', '角色', '角色后置提示词', charData?.post_history_instructions);

  const prompts = context.extensionPrompts || {};
  for (const [key, prompt] of Object.entries(prompts)) {
    if (prompt?.value) {
      const role = prompt?.role ? `role: ${prompt.role}` : '';
      const position = Number.isFinite(prompt?.position) ? `position: ${prompt.position}` : '';
      const depth = Number.isFinite(prompt?.depth) ? `depth: ${prompt.depth}` : '';
      addStructuredCandidate(candidates, '当前注入提示', '已启用注入', '预设', key, prompt.value, [role, position, depth].filter(Boolean).join(' · '));
    }
  }

  const presetSections = [
    ['sysprompt', '系统提示词'],
    ['context', '上下文模板'],
    ['instruct', '指令模板'],
    ['reasoning', '思考/Reasoning模板'],
  ];
  for (const [managerId, label] of presetSections) {
    try {
      const manager = context.getPresetManager?.(managerId);
      const presetName = manager?.getSelectedPresetName?.();
      const data = presetName ? manager?.getPresetSettings?.(presetName) : null;
      if (!data) continue;
      for (const [field, value] of Object.entries(data)) {
        if (typeof value === 'string' && value.trim()) {
          addStructuredCandidate(candidates, `当前预设：${label}`, presetName, '预设', field, value);
        }
      }
    } catch (error) {
      console.warn(`[${EXTENSION_ID}] 读取预设失败`, managerId, error);
    }
  }

  addStructuredCandidate(candidates, '用户设定', '当前用户', '全局', '用户人格', context.powerUserSettings?.persona_description);

  const worldNames = typeof context.getWorldInfoNames === 'function' ? context.getWorldInfoNames() : [];
  const selectedWorldNames = $('#world_info').val() || [];
  const namesToLoad = [...new Set([
    ...(Array.isArray(selectedWorldNames) ? selectedWorldNames : [selectedWorldNames]).filter(Boolean),
    ...worldNames,
  ])];
  if (typeof context.loadWorldInfo === 'function') {
    for (const worldName of namesToLoad) {
      try {
        const world = await context.loadWorldInfo(worldName);
        const entries = Object.values(world?.entries || {})
          .sort((a, b) => Number(a?.order ?? 0) - Number(b?.order ?? 0));
        for (const entry of entries) {
          if (entry?.content) {
            const title = entry.comment || entry.key?.join?.(', ') || `世界书条目 ${entry.uid ?? ''}`;
            const meta = [
              entry.disable ? '禁用' : '启用',
              entry.constant ? '常驻' : '',
              Number.isFinite(entry.order) ? `顺序 ${entry.order}` : '',
              Number.isFinite(entry.depth) ? `深度 ${entry.depth}` : '',
            ].filter(Boolean).join(' · ');
            addStructuredCandidate(candidates, `世界书：${worldName}`, worldName, '全局', title, entry.content, meta);
          }
        }
      } catch (error) {
        console.warn(`[${EXTENSION_ID}] 扫描世界书失败`, worldName, error);
      }
    }
  }

  importCandidates = candidates;
  renderImportCandidates();
  setStatus(`已列出 ${candidates.length} 个可导入条目。`);
}

function renderImportCandidates() {
  const box = $('#st-esg-import-candidates');
  if (!box.length) return;
  if (!importCandidates.length) {
    box.html('<div class="st-esg-empty">还没有可选来源。点击“刷新可选来源”后，会按预设、世界书、角色卡分组列出条目。</div>');
    return;
  }

  const groups = new Map();
  importCandidates.forEach((item, index) => {
    const groupName = item.group || item.source || '其他';
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push({ ...item, index });
  });

  box.html([...groups.entries()].map(([groupName, items]) => `
    <section class="st-esg-import-group">
      <div class="st-esg-import-group-head">
        <div>
          <div class="st-esg-import-group-title">${escapeHtml(groupName)}</div>
          <div class="st-esg-card-desc">${items.length} 个可选条目</div>
        </div>
        <button class="menu_button st-esg-import-group-toggle" type="button">本组全选</button>
      </div>
      <div class="st-esg-import-group-list">
        ${items.map((item) => `
          <div class="st-esg-import-item" data-index="${item.index}">
            <label class="st-esg-checkbox">
              <input class="st-esg-import-check" type="checkbox" />
              <span>${escapeHtml(item.name)} · ${escapeHtml(item.scope)} · ${escapeHtml(item.source)}</span>
            </label>
            ${item.meta ? `<div class="st-esg-import-meta">${escapeHtml(item.meta)}</div>` : ''}
            <pre>${escapeHtml(item.content.slice(0, 1200))}</pre>
          </div>
        `).join('')}
      </div>
    </section>
  `).join(''));

  $('.st-esg-import-group-toggle').on('click', function () {
    const checks = $(this).closest('.st-esg-import-group').find('.st-esg-import-check');
    const shouldCheck = checks.toArray().some((item) => !$(item).prop('checked'));
    checks.prop('checked', shouldCheck);
    $(this).text(shouldCheck ? '取消本组' : '本组全选');
  });
}

function importCheckedCandidates() {
  const checked = $('.st-esg-import-check:checked').toArray();
  if (!checked.length) {
    setStatus('请先勾选要导入的候选组件。');
    return;
  }

  for (const checkbox of checked) {
    const index = Number($(checkbox).closest('.st-esg-import-item').data('index'));
    const item = importCandidates[index];
    if (!item) continue;
    settings.components.push({
      id: String(Date.now() + index),
      name: item.name,
      scope: item.scope,
      content: item.content,
      enabled: true,
      source: item.source,
    });
  }

  saveSettings();
  renderComponentList();
  $('.st-esg-import-check').prop('checked', false);
  setStatus(`已导入 ${checked.length} 个组件。`);
}

function renderPluginPanel() {
  if ($('#st-external-statusbar-panel').length) return;

  const panel = $(`
    <div id="st-external-statusbar-panel" class="st-esg-panel st-esg-panel-hidden">
      <div class="st-esg-shell">
        <div class="st-esg-panel-header">
          <div class="st-esg-panel-title">
            <div class="st-esg-title-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
            <div><div class="st-esg-kicker">SillyTavern 插件</div><div class="st-esg-title-text">外置状态栏生成器</div></div>
          </div>
          <div id="st-esg-close" class="menu_button fa-solid fa-xmark" title="关闭面板"></div>
        </div>

        <div class="st-esg-panel-body">
          <section class="st-esg-hero">
            <div><div class="st-esg-hero-title">把文末组件从正文注意力里拆出来</div><div class="st-esg-hero-desc">正文先专心讲故事，状态栏由插件单独生成、预览、注入。</div></div>
            <div class="st-esg-status-pill"><span class="st-esg-dot"></span><span id="st-esg-status">插件已加载。</span></div>
          </section>

          <nav class="st-esg-tabs" aria-label="外置状态栏生成器分页">
            <button class="st-esg-tab" type="button" data-tab="workspace"><i class="fa-solid fa-sparkles"></i><span>生成结果</span></button>
            <button class="st-esg-tab" type="button" data-tab="runtime"><i class="fa-solid fa-sliders"></i><span>运行设置</span></button>
            <button class="st-esg-tab" type="button" data-tab="api"><i class="fa-solid fa-plug"></i><span>API 设置</span></button>
            <button class="st-esg-tab" type="button" data-tab="components"><i class="fa-solid fa-layer-group"></i><span>组件库</span></button>
            <button class="st-esg-tab" type="button" data-tab="output"><i class="fa-solid fa-code"></i><span>输出注入</span></button>
          </nav>

          <section class="st-esg-tab-panel" data-tab-panel="workspace">
            <div class="st-esg-card st-esg-preview-card">
              <div class="st-esg-card-head"><div><div class="st-esg-card-title">生成内容</div><div class="st-esg-card-desc">这里是状态栏生成结果。你可以先检查，再注入最新回复。</div></div></div>
              <textarea id="st-esg-preview" class="text_pole textarea_compact st-esg-textarea st-esg-preview" rows="11" placeholder="生成后的状态栏会出现在这里。"></textarea>
            </div>
            <div class="st-esg-workflow">
              <div class="st-esg-step"><b>1</b><span>读取最新助手回复</span></div>
              <div class="st-esg-step"><b>2</b><span>按组件与任务生成</span></div>
              <div class="st-esg-step"><b>3</b><span>预览后写回正文末尾</span></div>
            </div>
          </section>

          <section class="st-esg-tab-panel" data-tab-panel="runtime">
            <div class="st-esg-card">
              <div class="st-esg-card-head">
                <div><div class="st-esg-card-title">运行模式</div><div class="st-esg-card-desc">控制插件是否监听正文生成，以及生成后是否自动注入。</div></div>
                <label class="st-esg-switch"><input id="st-esg-enabled" type="checkbox" /><span></span><em>启用</em></label>
              </div>
              <select id="st-esg-mode" class="text_pole st-esg-select">
                <option value="autoInject">自动生成，并自动注入最新回复</option>
                <option value="autoReview">自动生成，但手动确认注入</option>
                <option value="manual">手动点击生成，手动注入</option>
              </select>
            </div>
            <div class="st-esg-card">
              <div class="st-esg-card-head"><div><div class="st-esg-card-title">生成任务指令</div><div class="st-esg-card-desc">告诉插件“要补什么状态栏组件”。这会作为外置生成任务的核心约束。</div></div></div>
              <textarea id="st-esg-task" class="text_pole textarea_compact st-esg-textarea" rows="7"></textarea>
            </div>
          </section>

          <section class="st-esg-tab-panel" data-tab-panel="api">
            <div class="st-esg-card">
              <div class="st-esg-card-head"><div><div class="st-esg-card-title">独立 API</div><div class="st-esg-card-desc">支持 OpenAI-compatible /v1/chat/completions。留空时只生成占位内容。</div></div></div>
              <div class="st-esg-grid">
                <label>API 地址<input id="st-esg-api-url" class="text_pole" type="text" placeholder="例如 https://api.openai.com/v1" /></label>
                <label>模型名称<input id="st-esg-api-model" class="text_pole" type="text" placeholder="例如 gpt-4o-mini / deepseek-chat" /></label>
                <label>最大输出<input id="st-esg-max-tokens" class="text_pole" type="number" min="1" step="1" /></label>
                <label>温度<input id="st-esg-temperature" class="text_pole" type="number" min="0" max="2" step="0.1" /></label>
              </div>
              <label class="st-esg-secret-label">API Key<input id="st-esg-api-key" class="text_pole" type="password" placeholder="可选。多数独立 API 需要填写。" /></label>
            </div>
          </section>

          <section class="st-esg-tab-panel" data-tab-panel="components">
            <div class="st-esg-card">
              <div class="st-esg-card-head"><div><div class="st-esg-card-title">添加组件</div><div class="st-esg-card-desc">可以手动添加，也可以从当前预设、世界书条目、角色卡字段里勾选导入。</div></div></div>
              <div class="st-esg-grid">
                <label>组件名<input id="st-esg-component-name" class="text_pole" type="text" placeholder="例如：人物状态栏" /></label>
                <label>分类<select id="st-esg-component-scope" class="text_pole"><option>全局</option><option>预设</option><option>角色</option></select></label>
              </div>
              <textarea id="st-esg-component-content" class="text_pole textarea_compact st-esg-textarea" rows="5" placeholder="在这里粘贴状态栏格式、要求或组件提示词。"></textarea>
              <div class="st-esg-actions-row">
                <div id="st-esg-add-component" class="menu_button menu_button_icon st-esg-secondary-action"><i class="fa-solid fa-plus"></i><span>添加到组件库</span></div>
                <div id="st-esg-scan-components" class="menu_button menu_button_icon st-esg-secondary-action"><i class="fa-solid fa-list-check"></i><span>刷新可选来源</span></div>
                <div id="st-esg-import-components" class="menu_button menu_button_icon st-esg-secondary-action"><i class="fa-solid fa-file-import"></i><span>导入勾选条目</span></div>
              </div>
            </div>
            <div id="st-esg-import-candidates" class="st-esg-import-list"><div class="st-esg-empty">还没有可选来源。点击“刷新可选来源”后，会按预设、世界书、角色卡分组列出条目。</div></div>
            <div id="st-esg-component-list" class="st-esg-component-list"></div>
          </section>

          <section class="st-esg-tab-panel" data-tab-panel="output">
            <div class="st-esg-card">
              <div class="st-esg-card-head"><div><div class="st-esg-card-title">注入方式</div><div class="st-esg-card-desc">决定每次注入是替换旧状态栏，还是追加到正文末尾。</div></div></div>
              <select id="st-esg-inject-mode" class="text_pole st-esg-select"><option value="replace">同名标记存在时替换，否则追加</option><option value="append">始终追加到最新回复末尾</option></select>
            </div>
            <div class="st-esg-card">
              <div class="st-esg-card-head"><div><div class="st-esg-card-title">输出清理</div><div class="st-esg-card-desc">每行一个标签或包裹符，用于清理模型多余输出。</div></div></div>
              <textarea id="st-esg-cleanup-tags" class="text_pole textarea_compact st-esg-textarea" rows="5" placeholder="例如：&#10;<status>&#10;</status>"></textarea>
            </div>
            <div class="st-esg-card st-esg-compact-card"><label class="st-esg-checkbox"><input id="st-esg-ball-visible" type="checkbox" /><span>显示可选悬浮快捷按钮</span></label></div>
          </section>
        </div>

        <div class="st-esg-panel-footer">
          <div id="st-esg-generate" class="menu_button menu_button_icon st-esg-primary-action"><i class="fa-solid fa-sparkles"></i><span>生成状态栏</span></div>
          <div id="st-esg-inject" class="menu_button menu_button_icon st-esg-secondary-action"><i class="fa-solid fa-file-import"></i><span>注入最新回复</span></div>
        </div>
      </div>
    </div>
  `);

  $('body').append(panel);

  $('#st-esg-enabled').prop('checked', settings.enabled);
  $('#st-esg-ball-visible').prop('checked', settings.ballVisible);
  $('#st-esg-mode').val(settings.mode);
  $('#st-esg-task').val(settings.taskPrompt);
  $('#st-esg-preview').val(settings.lastGenerated);
  $('#st-esg-api-url').val(settings.apiUrl);
  $('#st-esg-api-key').val(settings.apiKey);
  $('#st-esg-api-model').val(settings.apiModel);
  $('#st-esg-max-tokens').val(settings.maxTokens);
  $('#st-esg-temperature').val(settings.temperature);
  $('#st-esg-inject-mode').val(settings.injectMode);
  $('#st-esg-cleanup-tags').val(settings.cleanupTags);
  renderComponentList();
  switchTab(settings.activeTab || 'workspace');

  $('#st-esg-close').on('click', () => togglePanel(false));
  panel.on('mousedown', (event) => { if (event.target === panel[0]) togglePanel(false); });
  $('.st-esg-tab').on('click', function () { switchTab(String($(this).data('tab'))); });
  $('#st-esg-add-component').on('click', addComponent);
  $('#st-esg-scan-components').on('click', scanImportCandidates);
  $('#st-esg-import-components').on('click', importCheckedCandidates);

  $('#st-esg-enabled').on('change', function () { settings.enabled = Boolean($(this).prop('checked')); saveSettings(); });
  $('#st-esg-ball-visible').on('change', function () { settings.ballVisible = Boolean($(this).prop('checked')); saveSettings(); renderFloatingBall(); });
  $('#st-esg-mode').on('change', function () { settings.mode = String($(this).val()); saveSettings(); });
  $('#st-esg-task').on('input', function () { settings.taskPrompt = String($(this).val()); saveSettings(); });
  $('#st-esg-preview').on('input', function () { settings.lastGenerated = String($(this).val()); saveSettings(); });
  $('#st-esg-api-url').on('input', function () { settings.apiUrl = String($(this).val()); saveSettings(); });
  $('#st-esg-api-key').on('input', function () { settings.apiKey = String($(this).val()); saveSettings(); });
  $('#st-esg-api-model').on('input', function () { settings.apiModel = String($(this).val()); saveSettings(); });
  $('#st-esg-max-tokens').on('input', function () { settings.maxTokens = String($(this).val()); saveSettings(); });
  $('#st-esg-temperature').on('input', function () { settings.temperature = String($(this).val()); saveSettings(); });
  $('#st-esg-inject-mode').on('change', function () { settings.injectMode = String($(this).val()); saveSettings(); });
  $('#st-esg-cleanup-tags').on('input', function () { settings.cleanupTags = String($(this).val()); saveSettings(); });
  $('#st-esg-generate').on('click', generateStatusbar);
  $('#st-esg-inject').on('click', injectGeneratedStatusbar);
}

function mountUi() {
  if (!document.body) {
    window.setTimeout(mountUi, 500);
    return;
  }
  renderMagicWandMenuButton();
  renderFloatingBall();
  renderPluginPanel();
}

function loadStylesheet() {
  if (document.getElementById(`${EXTENSION_ID}-style`)) return;
  const link = document.createElement('link');
  link.id = `${EXTENSION_ID}-style`;
  link.rel = 'stylesheet';
  link.href = new URL(`./style.css?ver=${EXTENSION_VERSION}`, import.meta.url).href;
  document.head.appendChild(link);
}

function init() {
  if (initialized) return;
  initialized = true;
  loadSettings();
  loadStylesheet();
  mountUi();
  const context = getContext();
  context.eventSource.on(context.eventTypes.GENERATION_ENDED, handleGenerationEnded);
  console.log(`[${EXTENSION_ID}] 已加载`);
}

init();
