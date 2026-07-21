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

assert.deepEqual(messages.map((message) => message.role), ['system', 'user', 'user', 'assistant', 'user']);
assert.equal(messages[0].content, 'Write as CharName for UserName.');
assert.ok(messages[1].content.includes('用户：Hello'));
assert.ok(messages[1].content.includes('助手：Reply'));
assert.ok(!messages.some((message) => message.content.includes('SHOULD_NOT_EXIST')));
assert.equal(messages[2].role, 'user');
assert.equal(messages[2].content, 'Hello');
assert.equal(messages[3].role, 'assistant');
assert.equal(messages[3].content, 'Reply');
assert.ok(messages[4].content.includes('Generate footer widgets only.'));
assert.ok(messages[4].content.includes('<roleplay_options />'));
assert.ok(!messages[4].content.includes('最新助手回复'));
assert.ok(!messages[4].content.includes('Latest assistant prose'));

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

const messagesFromSelectedSources = buildExternalStatusbarMessages({
  targetWindow: {
    TavernHelper: {
      getCurrentPresetName: () => 'Main Preset',
      getPreset: () => ({
        prompts: [{ identifier: 'should-not-duplicate', role: 'system', content: 'Should not be used when source items exist' }],
      }),
    },
  },
  context,
  latestMessage: { mes: 'Latest assistant prose' },
  taskPrompt: 'Generate footer widgets only.',
  components: [],
  promptSourceItems: [
    { scope: '预设', name: 'Ako order 1', role: 'system', content: 'Selected preset prompt' },
    { scope: '世界书', name: 'Status lore', content: 'Selected worldbook entry' },
  ],
});

assert.deepEqual(messagesFromSelectedSources.map((message) => message.role), ['system', 'system', 'user', 'assistant', 'user']);
assert.equal(messagesFromSelectedSources[0].content, 'Selected preset prompt');
assert.equal(messagesFromSelectedSources[1].content, 'Selected worldbook entry');
assert.ok(!messagesFromSelectedSources.some((message) => message.content.includes('Should not be used')));

const messagesWithMacroSubstitution = buildExternalStatusbarMessages({
  targetWindow: {},
  context,
  latestMessage: { mes: 'Latest {{char}} prose' },
  taskPrompt: 'Task for {{user}}',
  components: [{ scope: '全局', name: 'Macro component', content: 'Component for {{char}}' }],
  promptSourceItems: [
    { scope: '预设', name: 'Macro preset', role: 'system', content: 'Preset for {{char}} and {{user}}' },
  ],
  substituteParams: (content) => String(content).replaceAll('{{char}}', 'CharName').replaceAll('{{user}}', 'UserName'),
});

assert.equal(messagesWithMacroSubstitution[0].content, 'Preset for CharName and UserName');
assert.ok(messagesWithMacroSubstitution.at(-1).content.includes('Task for UserName'));
assert.ok(messagesWithMacroSubstitution.at(-1).content.includes('Component for CharName'));
