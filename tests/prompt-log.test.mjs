import assert from 'node:assert/strict';
import { createPromptLog } from '../prompt-log.js';

const log = createPromptLog({
  apiUrl: 'https://example.com/v1/chat/completions',
  apiKey: 'secret-key-should-not-appear',
  model: 'test-model',
  maxTokens: 512,
  temperature: 0.6,
  messages: [
    { role: 'system', content: 'System prompt' },
    { role: 'user', content: 'Generate statusbar' },
  ],
  createdAt: '2026-07-22T00:00:00.000Z',
});

const parsed = JSON.parse(log);
assert.equal(parsed.createdAt, '2026-07-22T00:00:00.000Z');
assert.equal(parsed.request.model, 'test-model');
assert.equal(parsed.request.messages.length, 2);
assert.equal(parsed.summary.messageCount, 2);
assert.equal(parsed.summary.characterCount, 'System promptGenerate statusbar'.length);
assert.ok(!log.includes('secret-key-should-not-appear'));
