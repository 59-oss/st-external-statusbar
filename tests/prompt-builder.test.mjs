import assert from 'node:assert/strict';
import { buildExternalStatusbarMessages } from '../prompt-builder.js';

const targetWindow = {
  TavernHelper: {
    getCurrentPresetName: () => 'Main Preset',
    getPreset: () => ({
      prompt_order: [{ order: [
        { identifier: 'system-main', enabled: true },
        { identifier: 'disabled-one', enabled: false },
        { identifier: 'history', enabled: true },
      ] }],
      prompts: [
        { identifier: 'history', role: 'user', content: 'History here:\n{{chatHistory}}' },
        { identifier: 'system-main', role: 'system', content: 'Write as {{char}} for {{user}}.' },
        { identifier: 'disabled-one', role: 'system', content: 'SHOULD_NOT_EXIST' },
      ],
    }),
  },
};

const context = {
  name1: 'UserName',
  name2: 'CharName',
  chat: [
    { is_user: true, mes: 'Hello' },
    { is_user: false, mes: 'Reply' },
  ],
};

const messages = buildExternalStatusbarMessages({
  targetWindow,
  context,
  latestMessage: { mes: 'Latest assistant prose' },
  taskPrompt: 'Generate footer widgets only.',
  components: [{ scope: '全局', name: 'Choices', content: '<roleplay_options />' }],
});

assert.deepEqual(messages.map((message) => message.role), ['system', 'user', 'user']);
assert.equal(messages[0].content, 'Write as CharName for UserName.');
assert.ok(messages[1].content.includes('用户：Hello'));
assert.ok(messages[1].content.includes('助手：Reply'));
assert.ok(!messages.some((message) => message.content.includes('SHOULD_NOT_EXIST')));
assert.ok(messages[2].content.includes('Generate footer widgets only.'));
assert.ok(messages[2].content.includes('<roleplay_options />'));
assert.ok(messages[2].content.includes('Latest assistant prose'));

const messagesWithoutPresetName = buildExternalStatusbarMessages({
  targetWindow: {
    TavernHelper: {
      getCurrentPresetName: () => '',
      getSelectedPresetName: () => '',
      getPreset: (name) => {
        throw new Error(`Preset ${name} not found`);
      },
    },
  },
  context,
  latestMessage: { mes: 'Latest assistant prose' },
  taskPrompt: 'Generate footer widgets only.',
  components: [],
});

assert.equal(messagesWithoutPresetName[0].role, 'system');
assert.equal(messagesWithoutPresetName.at(-1).role, 'user');
