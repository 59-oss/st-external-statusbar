import { getContext } from '../../../st-context.js';

const EXTENSION_ID = 'st-external-statusbar';
const START = '<!-- ST-STATUSBAR-START -->';
const END = '<!-- ST-STATUSBAR-END -->';

const DEFAULT_SETTINGS = {
  enabled: false,
  mode: 'manual',
  taskPrompt: '根据刚刚正文补全文尾组件，只输出组件，不续写正文。',
  lastGenerated: '',
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

function buildPlaceholderStatusbar(latestMessage) {
  return [
    '【外置状态栏生成器】',
    `任务：${settings.taskPrompt}`,
    '状态：这里是插件入口占位输出，下一步会接入真实 API 生成。',
    `参考正文长度：${latestMessage.mes.length} 字符`,
  ].join('\n');
}

function injectStatusbar(message, text) {
  const block = `${START}\n${text}\n${END}`;
  if (message.mes.includes(START) && message.mes.includes(END)) {
    message.mes = message.mes.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
  } else {
    message.mes = `${message.mes}\n\n${block}`.trim();
  }
}

async function generateStatusbar() {
  const context = getContext();
  const latest = getLatestAssistantMessage(context.chat);
  if (!latest) {
    setStatus('没有找到可注入的 AI 消息。');
    return '';
  }

  const result = buildPlaceholderStatusbar(latest.message);
  settings.lastGenerated = result;
  saveSettings();
  $('#st-esg-preview').val(result);
  setStatus('已生成占位状态栏。');
  return result;
}

async function injectGeneratedStatusbar() {
  const context = getContext();
  const latest = getLatestAssistantMessage(context.chat);
  if (!latest) {
    setStatus('没有找到可注入的 AI 消息。');
    return;
  }

  const text = settings.lastGenerated || $('#st-esg-preview').val() || await generateStatusbar();
  if (!text) return;

  injectStatusbar(latest.message, text);

  if (Array.isArray(latest.message.swipes) && Number.isInteger(latest.message.swipe_id)) {
    latest.message.swipes[latest.message.swipe_id] = latest.message.mes;
  }

  context.updateMessageBlock(latest.index, latest.message);
  await context.saveChat();
  setStatus('已注入到最新 AI 回复末尾。');
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

function renderSettingsPanel() {
  if ($('#st-external-statusbar-panel').length) return;

  const panel = $(`
    <div id="st-external-statusbar-panel" class="extension_container st-esg-panel">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>External Statusbar Generator</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <label class="checkbox_label">
            <input id="st-esg-enabled" type="checkbox" />
            <span>启用外置状态栏生成器</span>
          </label>

          <label for="st-esg-mode">生成模式</label>
          <select id="st-esg-mode" class="text_pole">
            <option value="autoInject">正文结束后自动生成并注入</option>
            <option value="autoReview">正文结束后自动生成，手动注入</option>
            <option value="manual">手动生成，手动注入</option>
          </select>

          <label for="st-esg-task">生成任务指令</label>
          <textarea id="st-esg-task" class="text_pole textarea_compact" rows="4"></textarea>

          <div class="flex-container">
            <div id="st-esg-generate" class="menu_button">生成状态栏</div>
            <div id="st-esg-inject" class="menu_button">注入到最新回复</div>
          </div>

          <label for="st-esg-preview">生成结果预览</label>
          <textarea id="st-esg-preview" class="text_pole textarea_compact" rows="6"></textarea>

          <small id="st-esg-status" class="st-esg-status">插件已加载。</small>
        </div>
      </div>
    </div>
  `);

  ($('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings')).append(panel);

  $('#st-esg-enabled').prop('checked', settings.enabled);
  $('#st-esg-mode').val(settings.mode);
  $('#st-esg-task').val(settings.taskPrompt);
  $('#st-esg-preview').val(settings.lastGenerated);

  $('#st-esg-enabled').on('change', function () {
    settings.enabled = Boolean($(this).prop('checked'));
    saveSettings();
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

  $('#st-esg-generate').on('click', generateStatusbar);
  $('#st-esg-inject').on('click', injectGeneratedStatusbar);
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
  renderSettingsPanel();

  const context = getContext();
  context.eventSource.on(context.eventTypes.GENERATION_ENDED, handleGenerationEnded);
  console.log(`[${EXTENSION_ID}] loaded`);
}

init();
