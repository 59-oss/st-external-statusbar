const LEGACY_START = '<!-- ST-STATUSBAR-START -->';
const LEGACY_END = '<!-- ST-STATUSBAR-END -->';

export function removeLegacyStatusbarBlock(messageText) {
  const text = String(messageText || '');
  const start = text.indexOf(LEGACY_START);
  const end = text.indexOf(LEGACY_END, start + LEGACY_START.length);
  if (start === -1 || end === -1) return text;
  return `${text.slice(0, start)}${text.slice(end + LEGACY_END.length)}`.trim();
}

export function injectStatusbarText(messageText, statusbarText, { mode = 'append' } = {}) {
  const cleanText = String(statusbarText || '').trim();
  if (!cleanText) return String(messageText || '');
  const baseText = mode === 'replace' ? removeLegacyStatusbarBlock(messageText) : String(messageText || '');
  return `${baseText}\n\n${cleanText}`.trim();
}
