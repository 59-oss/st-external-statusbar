import { getContext } from '../../../st-context.js';

const EXTENSION_ID = 'st-external-statusbar';
const START = '<!-- ST-STATUSBAR-START -->';
const END = '<!-- ST-STATUSBAR-END -->';

let initialized = false;
let settings = {
  enabled: false,
  autoGenerate: false,
  autoInject: false,
  taskPrompt: '根据刚刚正文补全文尾组件，只输出组件，不续写正文。',
};

function getLatestAssistantMessage(chat) {
  for (let i = chat.length - 1; i >= 0; i -= 1) {
    const item = chat[i];
    if (item?.is_user) continue;
    if (item?.mes) return { index: i, message: item };
  }
  return null;
}

function injectStatusbar(message, text) {
  const block = `${START}\n${text}\n${END}`;
  if (message.mes.includes(START) && message.mes.includes(END)) {
    message.mes = message.mes.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
  } else {
    message.mes = `${message.mes}\n\n${block}`.trim();
  }
}

async function handleGenerationEnded() {
  if (!settings.enabled || !settings.autoInject) return;

  const context = getContext();
  const latest = getLatestAssistantMessage(context.chat);
  if (!latest) return;

  const statusbar = '【状态栏占位】';
  injectStatusbar(latest.message, statusbar);

  if (Array.isArray(latest.message.swipes) && Number.isInteger(latest.message.swipe_id)) {
    latest.message.swipes[latest.message.swipe_id] = latest.message.mes;
  }

  context.updateMessageBlock(latest.index, latest.message);
  await context.saveChat();
}

function init() {
  if (initialized) return;
  initialized = true;

  const context = getContext();
  context.eventSource.on(context.eventTypes.GENERATION_ENDED, handleGenerationEnded);
  console.log(`[${EXTENSION_ID}] loaded`);
}

init();
