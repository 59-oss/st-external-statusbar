import { getContext } from '../../../st-context.js';

const EXTENSION_ID = 'st-external-statusbar';
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
};

let initialized = false;
let settings = { ...DEFAULT_SETTINGS };

function getSettingsStore() {
  const context = getContext();
  context.extensionSettings[EXTENSION_ID] ??= {};
  return context.extensionSettings[EXTENSION_ID];
}

function loadSettings() {
  settings = Object.assign({ ...DEFAULT_SETTINGS }, getSettingsStore());
}

function saveSettings() {
  Object.assign(getSettingsStore(), settings);
  getContext().saveSettingsDebounced();
}

function getLatestAssistantMessage(chat) {
  for (let i = chat.length - 1; i >= 0; i -= 1) {
    const item = chat[i];
    if (item?.is_user) continue;
    if (item?.mes) return { index: i, message: item };
  }
  return null;
}

function cleanGeneratedText(text) {
  const tags = String(settings.cleanupTags || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  return tags.reduce((current, tag) => current.split(tag).join(''), text).trim();
}

function buildPlaceholderStatusbar(latestMessage) {
  return cleanGeneratedText([
    '[外置状态栏生成器]',
    `任务：${settings.taskPrompt}`,
    '状态：这是占位输出，后续会接入真正的 API 生成。',
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

  const result = buildPlaceholderStatusbar(latest.message);
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
  if (!settings.enabled) return;
  if (settings.mode === 'manual') return;

  const result = await generateStatusbar();
  if (settings.mode === 'autoInject' && result) {
    await injectGeneratedStatusbar();
  }
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

  const shouldOpen = typeof forceOpen === 'boolean'
    ? forceOpen
    : panel.hasClass('st-esg-panel-hidden');

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
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      togglePanel(true);
    }
  });

  menu.prepend(button);
}

function renderFloatingBall() {
  if (!settings.ballVisible) {
    $('#st-esg-ball').remove();
    return;
  }

  if ($('#st-esg-ball').length) return;

  const ball = $(`
    <button id="st-esg-ball" type="button" title="外置状态栏生成器">
      <i class="fa-solid fa-wand-magic-sparkles"></i>
    </button>
  `);

  ball.css({
    left: `${settings.ballX ?? 16}px`,
    bottom: `${settings.ballY ?? 16}px`,
  });

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
    const nextLeft = clamp(originLeft + dx, 0, window.innerWidth - 46);
    const nextBottom = clamp(originBottom - dy, 0, window.innerHeight - 46);
    ball.css({ left: `${nextLeft}px`, bottom: `${nextBottom}px` });
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    const left = parseFloat(ball.css('left')) || 16;
    const bottom = parseFloat(ball.css('bottom')) || 16;
    settings.ballX = left;
    settings.ballY = bottom;
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

function renderPluginPanel() {
  if ($('#st-external-statusbar-panel').length) return;

  const panel = $(`
    <div id="st-external-statusbar-panel" class="st-esg-panel st-esg-panel-hidden">
      <div class="st-esg-shell">
        <div class="st-esg-panel-header">
          <div class="st-esg-panel-title">
            <div class="st-esg-title-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
            <div>
              <div class="st-esg-kicker">SillyTavern 插件</div>
              <div class="st-esg-title-text">外置状态栏生成器</div>
            </div>
          </div>
          <div id="st-esg-close" class="menu_button fa-solid fa-xmark" title="关闭面板"></div>
        </div>

        <div class="st-esg-panel-body">
          <section class="st-esg-hero">
            <div>
              <div class="st-esg-hero-title">把文末组件从正文注意力里拆出来</div>
              <div class="st-esg-hero-desc">正文先专心讲故事，状态栏由插件单独生成、预览、注入。</div>
            </div>
            <div class="st-esg-status-pill">
              <span class="st-esg-dot"></span>
              <span id="st-esg-status">插件已加载。</span>
            </div>
          </section>

          <nav class="st-esg-tabs" aria-label="外置状态栏生成器分页">
            <button class="st-esg-tab" type="button" data-tab="workspace"><i class="fa-solid fa-sparkles"></i><span>生成结果</span></button>
            <button class="st-esg-tab" type="button" data-tab="runtime"><i class="fa-solid fa-sliders"></i><span>运行设置</span></button>
            <button class="st-esg-tab" type="button" data-tab="api"><i class="fa-solid fa-plug"></i><span>API 设置</span></button>
            <button class="st-esg-tab" type="button" data-tab="output"><i class="fa-solid fa-code"></i><span>输出注入</span></button>
          </nav>

          <section class="st-esg-tab-panel" data-tab-panel="workspace">
            <div class="st-esg-card st-esg-preview-card">
              <div class="st-esg-card-head">
                <div>
                  <div class="st-esg-card-title">生成内容</div>
                  <div class="st-esg-card-desc">这里是状态栏生成结果。你可以先检查，再注入最新回复。</div>
                </div>
              </div>
              <textarea id="st-esg-preview" class="text_pole textarea_compact st-esg-textarea st-esg-preview" rows="11" placeholder="生成后的状态栏会出现在这里。"></textarea>
            </div>

            <div class="st-esg-workflow">
              <div class="st-esg-step"><b>1</b><span>读取最新助手回复</span></div>
              <div class="st-esg-step"><b>2</b><span>单独生成文末组件</span></div>
              <div class="st-esg-step"><b>3</b><span>预览后写回正文末尾</span></div>
            </div>
          </section>

          <section class="st-esg-tab-panel" data-tab-panel="runtime">
            <div class="st-esg-card">
              <div class="st-esg-card-head">
                <div>
                  <div class="st-esg-card-title">运行模式</div>
                  <div class="st-esg-card-desc">控制插件是否监听正文生成，以及生成后是否自动注入。</div>
                </div>
                <label class="st-esg-switch">
                  <input id="st-esg-enabled" type="checkbox" />
                  <span></span>
                  <em>启用</em>
                </label>
              </div>

              <select id="st-esg-mode" class="text_pole st-esg-select">
                <option value="autoInject">自动生成，并自动注入最新回复</option>
                <option value="autoReview">自动生成，但手动确认注入</option>
                <option value="manual">手动点击生成，手动注入</option>
              </select>
            </div>

            <div class="st-esg-card">
              <div class="st-esg-card-head">
                <div>
                  <div class="st-esg-card-title">生成任务指令</div>
                  <div class="st-esg-card-desc">告诉插件“要补什么状态栏组件”。这会作为外置生成任务的核心约束。</div>
                </div>
              </div>
              <textarea id="st-esg-task" class="text_pole textarea_compact st-esg-textarea" rows="7"></textarea>
            </div>
          </section>

          <section class="st-esg-tab-panel" data-tab-panel="api">
            <div class="st-esg-card">
              <div class="st-esg-card-head">
                <div>
                  <div class="st-esg-card-title">独立 API</div>
                  <div class="st-esg-card-desc">留空时使用酒馆当前主 API；填写后可让状态栏走更便宜或更轻的模型。</div>
                </div>
              </div>
              <div class="st-esg-grid">
                <label>API 地址<input id="st-esg-api-url" class="text_pole" type="text" placeholder="留空则跟随主 API" /></label>
                <label>模型名称<input id="st-esg-api-model" class="text_pole" type="text" placeholder="例如 gpt-4o-mini / deepseek-chat" /></label>
                <label>最大输出<input id="st-esg-max-tokens" class="text_pole" type="number" min="1" step="1" /></label>
                <label>温度<input id="st-esg-temperature" class="text_pole" type="number" min="0" max="2" step="0.1" /></label>
              </div>
              <label class="st-esg-secret-label">API Key
                <input id="st-esg-api-key" class="text_pole" type="password" placeholder="可选。留空则不覆盖主 API 鉴权。" />
              </label>
            </div>
          </section>

          <section class="st-esg-tab-panel" data-tab-panel="output">
            <div class="st-esg-card">
              <div class="st-esg-card-head">
                <div>
                  <div class="st-esg-card-title">注入方式</div>
                  <div class="st-esg-card-desc">决定每次注入是替换旧状态栏，还是追加到正文末尾。</div>
                </div>
              </div>
              <select id="st-esg-inject-mode" class="text_pole st-esg-select">
                <option value="replace">同名标记存在时替换，否则追加</option>
                <option value="append">始终追加到最新回复末尾</option>
              </select>
            </div>

            <div class="st-esg-card">
              <div class="st-esg-card-head">
                <div>
                  <div class="st-esg-card-title">输出清理</div>
                  <div class="st-esg-card-desc">每行一个标签或包裹符。之后会用于清理模型多余输出。</div>
                </div>
              </div>
              <textarea id="st-esg-cleanup-tags" class="text_pole textarea_compact st-esg-textarea" rows="5" placeholder="例如：&#10;<status>&#10;</status>"></textarea>
            </div>

            <div class="st-esg-card st-esg-compact-card">
              <label class="st-esg-checkbox">
                <input id="st-esg-ball-visible" type="checkbox" />
                <span>显示可选悬浮快捷按钮</span>
              </label>
            </div>
          </section>
        </div>

        <div class="st-esg-panel-footer">
          <div id="st-esg-generate" class="menu_button menu_button_icon st-esg-primary-action">
            <i class="fa-solid fa-sparkles"></i>
            <span>生成状态栏</span>
          </div>
          <div id="st-esg-inject" class="menu_button menu_button_icon st-esg-secondary-action">
            <i class="fa-solid fa-file-import"></i>
            <span>注入最新回复</span>
          </div>
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
  switchTab(settings.activeTab || 'workspace');

  $('#st-esg-close').on('click', () => togglePanel(false));
  panel.on('mousedown', (event) => {
    if (event.target === panel[0]) togglePanel(false);
  });

  $('.st-esg-tab').on('click', function () {
    switchTab(String($(this).data('tab')));
  });

  $('#st-esg-enabled').on('change', function () {
    settings.enabled = Boolean($(this).prop('checked'));
    saveSettings();
  });

  $('#st-esg-ball-visible').on('change', function () {
    settings.ballVisible = Boolean($(this).prop('checked'));
    saveSettings();
    renderFloatingBall();
  });

  $('#st-esg-mode').on('change', function () {
    settings.mode = String($(this).val());
    saveSettings();
  });

  $('#st-esg-task').on('input', function () {
    settings.taskPrompt = String($(this).val());
    saveSettings();
  });

  $('#st-esg-preview').on('input', function () {
    settings.lastGenerated = String($(this).val());
    saveSettings();
  });

  $('#st-esg-api-url').on('input', function () {
    settings.apiUrl = String($(this).val());
    saveSettings();
  });

  $('#st-esg-api-key').on('input', function () {
    settings.apiKey = String($(this).val());
    saveSettings();
  });

  $('#st-esg-api-model').on('input', function () {
    settings.apiModel = String($(this).val());
    saveSettings();
  });

  $('#st-esg-max-tokens').on('input', function () {
    settings.maxTokens = String($(this).val());
    saveSettings();
  });

  $('#st-esg-temperature').on('input', function () {
    settings.temperature = String($(this).val());
    saveSettings();
  });

  $('#st-esg-inject-mode').on('change', function () {
    settings.injectMode = String($(this).val());
    saveSettings();
  });

  $('#st-esg-cleanup-tags').on('input', function () {
    settings.cleanupTags = String($(this).val());
    saveSettings();
  });

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
  link.href = new URL('./style.css', import.meta.url).href;
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
