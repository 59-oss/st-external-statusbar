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
assert.equal(parsed.summary.extensionVersion, '');
assert.equal(parsed.request.model, 'test-model');
assert.equal(parsed.request.messages.length, 2);
assert.equal(parsed.summary.messageCount, 2);
assert.equal(parsed.summary.characterCount, 'System promptGenerate statusbar'.length);
assert.ok(!log.includes('secret-key-should-not-appear'));

const diagnosticLog = JSON.parse(createPromptLog({
  extensionVersion: '0.3.38',
  messages: [
    { role: 'system', content: '# <user_info>提供User的角色设定\n<user_info>' },
    { role: 'system', content: '</user_info>' },
    { role: 'system', content: '<char_info>' },
    { role: 'system', content: '角色描述' },
    { role: 'system', content: '</char_info>' },
  ],
}));

assert.equal(diagnosticLog.summary.extensionVersion, '0.3.38');
assert.deepEqual(diagnosticLog.diagnostics.emptyBlocks, [
  { tag: 'user_info', startIndex: 0, endIndex: 1 },
]);

const runtimeDiagnosticLog = JSON.parse(createPromptLog({
  runtimeDiagnostics: {
    characterFields: {
      characterId: '0',
      descriptionLength: 24,
      personalityLength: 8,
      scenarioLength: 0,
    },
  },
  messages: [],
}));

assert.deepEqual(runtimeDiagnosticLog.diagnostics.characterFields, {
  characterId: '0',
  descriptionLength: 24,
  personalityLength: 8,
  scenarioLength: 0,
});
