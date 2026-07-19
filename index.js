import { getContext } from '../../../st-context.js';

const EXTENSION_ID = 'st-external-statusbar';
const START = '<!-- ST-STATUSBAR-START -->';
const END = '<!-- ST-STATUSBAR-END -->';

const DEFAULT_SETTINGS = {
  enabled: false,
  mode: 'manual',
  taskPrompt: '鏍规嵁鍒氬垰姝ｆ枃琛ュ叏鏂囧熬缁勪欢銆傚彧杈撳嚭缁勪欢锛屼笉缁啓姝ｆ枃銆?,
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
    '銆愬缃姸鎬佹爮鐢熸垚鍣ㄣ€?,
    `浠诲姟锛?{settings.taskPrompt}`,
    '鐘舵€侊細杩欓噷鏄彃浠跺叆鍙ｅ崰浣嶈緭鍑猴紝涓嬩竴姝ヤ細鎺ュ叆鐪熷疄 API 鐢熸垚銆?,
    `鍙傝€冩鏂囬暱搴︼細${latestMessage.mes.length} 瀛楃`,
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
    setStatus('娌℃湁鎵惧埌鍙敞鍏ョ殑 AI 鍥炲銆?);
    return '';
  }

  const result = buildPlaceholderStatusbar(latest.message);
  settings.lastGenerated = result;
  saveSettings();
  $('#st-esg-preview').val(result);
  setStatus('宸茬敓鎴愬崰浣嶇姸鎬佹爮銆?);
  return result;
}

async function injectGeneratedStatusbar() {
  const context = getContext();
  const latest = getLatestAssistantMessage(context.chat);
  if (!latest) {
    setStatus('娌℃湁鎵惧埌鍙敞鍏ョ殑 AI 鍥炲銆?);
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
  setStatus('宸叉敞鍏ュ埌鏈€鏂?AI 鍥炲鏈熬銆?);
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

function togglePanel(forceOpen) {
  const panel = $('#st-external-statusbar-panel');
  if (!panel.length) return;

  const shouldOpen = typeof forceOpen === 'boolean'
    ? forceOpen
    : panel.hasClass('st-esg-panel-hidden');

  panel.toggleClass('st-esg-panel-hidden', !shouldOpen);
  $('#st-esg-launcher').toggleClass('selected', shouldOpen);
}

function renderLauncher() {
  if ($('#st-esg-launcher').length) return;

  const launcher = $(`
    <div id="st-esg-launcher"
         class="menu_button menu_button_icon"
         title="External Statusbar Generator">
      <i class="fa-solid fa-wand-magic-sparkles"></i>
      <span>鐘舵€佹爮鐢熸垚鍣?/span>
    </div>
  `);

  const installButton = $('#third_party_extension_button');
  const header = $('#rm_extensions_block .alignitemscenter.flex-container').first();

  if (installButton.length) {
    launcher.insertAfter(installButton);
  } else if (header.length) {
    header.append(launcher);
  } else {
    $('#extensions-settings-button').prepend(launcher);
  }

  launcher.on('click', () => togglePanel());
}

function renderPluginPanel() {
  if ($('#st-external-statusbar-panel').length) return;

  const panel = $(`
    <div id="st-external-statusbar-panel" class="extension_container st-esg-panel st-esg-panel-hidden">
      <div class="st-esg-panel-header">
        <div class="st-esg-panel-title">
          <i class="fa-solid fa-wand-magic-sparkles"></i>
          <span>External Statusbar Generator</span>
        </div>
        <div id="st-esg-close" class="menu_button fa-solid fa-xmark" title="鍏抽棴闈㈡澘"></div>
      </div>

      <div class="st-esg-panel-body">
        <label class="checkbox_label">
          <input id="st-esg-enabled" type="checkbox" />
          <span>鍚敤澶栫疆鐘舵€佹爮鐢熸垚鍣?/span>
        </label>

        <label for="st-esg-mode">鐢熸垚妯″紡</label>
        <select id="st-esg-mode" class="text_pole">
          <option value="autoInject">姝ｆ枃缁撴潫鍚庤嚜鍔ㄧ敓鎴愬苟娉ㄥ叆</option>
          <option value="autoReview">姝ｆ枃缁撴潫鍚庤嚜鍔ㄧ敓鎴愶紝鎵嬪姩娉ㄥ叆</option>
          <option value="manual">鎵嬪姩鐢熸垚锛屾墜鍔ㄦ敞鍏?/option>
        </select>

        <label for="st-esg-task">鐢熸垚浠诲姟鎸囦护</label>
        <textarea id="st-esg-task" class="text_pole textarea_compact" rows="4"></textarea>

        <div class="st-esg-actions">
          <div id="st-esg-generate" class="menu_button menu_button_icon">
            <i class="fa-solid fa-wand-magic-sparkles"></i>
            <span>鐢熸垚鐘舵€佹爮</span>
          </div>
          <div id="st-esg-inject" class="menu_button menu_button_icon">
            <i class="fa-solid fa-file-import"></i>
            <span>娉ㄥ叆鍒版渶鏂板洖澶?/span>
          </div>
        </div>

        <label for="st-esg-preview">鐢熸垚缁撴灉棰勮</label>
        <textarea id="st-esg-preview" class="text_pole textarea_compact" rows="6"></textarea>

        <small id="st-esg-status" class="st-esg-status">鎻掍欢宸插姞杞姐€?/small>
      </div>
    </div>
  `);

  const target = $('#extensions_settings').length ? $('#extensions_settings') : $('#rm_extensions_block');
  target.prepend(panel);

  $('#st-esg-enabled').prop('checked', settings.enabled);
  $('#st-esg-mode').val(settings.mode);
  $('#st-esg-task').val(settings.taskPrompt);
  $('#st-esg-preview').val(settings.lastGenerated);

  $('#st-esg-close').on('click', () => togglePanel(false));

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

function mountUi() {
  if (!$('#extensions-settings-button').length) {
    window.setTimeout(mountUi, 500);
    return;
  }

  renderLauncher();
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
  console.log(`[${EXTENSION_ID}] loaded`);
}

init();
