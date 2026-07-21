const textOf = (value) => String(value ?? '');

export function createPromptLog({
  apiUrl = '',
  apiKey = '',
  model = '',
  maxTokens = '',
  temperature = '',
  messages = [],
  createdAt = new Date().toISOString(),
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
    },
    request: {
      apiUrl: textOf(apiUrl),
      model: textOf(model),
      max_tokens: Number(maxTokens) || 800,
      temperature: Number(temperature) || 0.7,
      messages: cleanMessages,
    },
  }, null, 2);
}
