const textOf = (value) => String(value ?? '');

function getTrailingOpenTag(content) {
  const match = textOf(content).trim().match(/<([A-Za-z0-9_\-\u4e00-\u9fff]+)(?:\s[^>]*)?>$/u);
  return match?.[1] || '';
}

function isOnlyClosingTag(content, tag) {
  return textOf(content).trim() === `</${tag}>`;
}

function createDiagnostics(messages) {
  const emptyBlocks = [];
  for (let index = 0; index < messages.length - 1; index += 1) {
    const tag = getTrailingOpenTag(messages[index]?.content);
    if (!tag) continue;
    if (isOnlyClosingTag(messages[index + 1]?.content, tag)) {
      emptyBlocks.push({ tag, startIndex: index, endIndex: index + 1 });
    }
  }
  return { emptyBlocks };
}

function mergeDiagnostics(baseDiagnostics, runtimeDiagnostics) {
  if (!runtimeDiagnostics || typeof runtimeDiagnostics !== 'object') return baseDiagnostics;
  return { ...baseDiagnostics, ...runtimeDiagnostics };
}

export function createPromptLog({
  apiUrl = '',
  apiKey = '',
  model = '',
  maxTokens = '',
  temperature = '',
  messages = [],
  createdAt = new Date().toISOString(),
  extensionVersion = '',
  runtimeDiagnostics = {},
} = {}) {
  const cleanMessages = (Array.isArray(messages) ? messages : []).map((message) => ({
    role: textOf(message?.role || 'user'),
    content: textOf(message?.content),
  }));
  const characterCount = cleanMessages.reduce((sum, message) => sum + message.content.length, 0);
  return JSON.stringify({
    createdAt,
    summary: {
      messageCount: cleanMessages.length,
      characterCount,
      hasApiKey: Boolean(apiKey),
      extensionVersion: textOf(extensionVersion),
    },
    diagnostics: mergeDiagnostics(createDiagnostics(cleanMessages), runtimeDiagnostics),
    request: {
      apiUrl: textOf(apiUrl),
      model: textOf(model),
      max_tokens: Number(maxTokens) || 800,
      temperature: Number(temperature) || 0.7,
      messages: cleanMessages,
    },
  }, null, 2);
}
