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
  characterId: '0',
  characters: [{ description: 'Runtime character description', personality: 'Runtime personality', scenario: 'Runtime scenario', mes_example: 'Runtime examples' }],
  getCharacterCardFields: () => ({
    description: 'Card fields description',
    personality: 'Card fields personality',
    scenario: 'Card fields scenario',
    mesExamples: 'Card fields examples',
    persona: 'Card fields persona',
  }),
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
assert.ok(!messages[4].content.includes('【组件 1'));
assert.ok(!messages[4].content.includes('Choices'));
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

const messagesFromPresetMarkers = buildExternalStatusbarMessages({
  targetWindow: {
    TavernHelper: {
      getCurrentPresetName: () => 'Marker Preset',
      getPreset: () => ({
        prompt_order: [{ character_id: 100001, order: [
          { identifier: 'charDescription', enabled: true },
          { identifier: 'charPersonality', enabled: true },
          { identifier: 'scenario', enabled: true },
          { identifier: 'dialogueExamples', enabled: true },
          { identifier: 'personaDescription', enabled: true },
          { identifier: 'chatHistory', enabled: true },
        ] }],
        prompts: [
          { identifier: 'charDescription', name: 'Char Description', marker: true, role: 'system', content: '' },
          { identifier: 'charPersonality', name: 'Char Personality', marker: true, role: 'system', content: '' },
          { identifier: 'scenario', name: 'Scenario', marker: true, role: 'system', content: '' },
          { identifier: 'dialogueExamples', name: 'Chat Examples', marker: true, role: 'system', content: '' },
          { identifier: 'personaDescription', name: 'Persona Description', marker: true, role: 'system', content: '' },
          { identifier: 'chatHistory', name: 'Chat History', marker: true, role: 'system', content: '' },
        ],
      }),
    },
  },
  context,
  latestMessage: { mes: 'Latest assistant prose' },
  taskPrompt: 'Generate footer widgets only.',
  components: [],
});

assert.deepEqual(messagesFromPresetMarkers.slice(0, 8).map((message) => message.role), ['system', 'system', 'system', 'system', 'system', 'user', 'assistant', 'user']);
assert.equal(messagesFromPresetMarkers[0].content, 'Card fields description');
assert.equal(messagesFromPresetMarkers[1].content, 'Card fields personality');
assert.equal(messagesFromPresetMarkers[2].content, 'Card fields scenario');
assert.equal(messagesFromPresetMarkers[3].content, 'Card fields examples');
assert.equal(messagesFromPresetMarkers[4].content, 'Card fields persona');

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

assert.deepEqual(messagesFromSelectedSources.map((message) => message.role), ['system', 'system', 'user']);
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
assert.ok(!messagesWithMacroSubstitution.at(-1).content.includes('Macro component'));

const messagesWithNativeMarkers = buildExternalStatusbarMessages({
  targetWindow: {},
  context,
  latestMessage: { mes: 'Latest assistant prose' },
  taskPrompt: 'Generate footer widgets only.',
  components: [],
  promptSourceItems: [
    { scope: '预设', markerType: 'worldInfoBefore', role: 'system', content: '世界书占位' },
    { scope: '世界书', name: 'Lore', role: 'system', content: 'Selected lore text' },
    { scope: '预设', markerType: 'charDescription', role: 'system', content: '扫描时占位' },
    { scope: '预设', markerType: 'charPersonality', role: 'system', content: '扫描时占位' },
    { scope: '预设', markerType: 'scenario', role: 'system', content: '扫描时占位' },
    { scope: '预设', markerType: 'dialogueExamples', role: 'system', content: '扫描时占位' },
    { scope: '预设', markerType: 'personaDescription', role: 'system', content: '扫描时占位' },
    { scope: '预设', markerType: 'chatHistory', role: 'system', content: '聊天历史占位' },
  ],
});

assert.deepEqual(messagesWithNativeMarkers.slice(0, 9).map((message) => message.role), ['system', 'system', 'system', 'system', 'system', 'system', 'user', 'assistant', 'user']);
assert.equal(messagesWithNativeMarkers[0].content, 'Selected lore text');
assert.equal(messagesWithNativeMarkers[1].content, 'Card fields description');
assert.equal(messagesWithNativeMarkers[2].content, 'Card fields personality');
assert.equal(messagesWithNativeMarkers[3].content, 'Card fields scenario');
assert.equal(messagesWithNativeMarkers[4].content, 'Card fields examples');
assert.equal(messagesWithNativeMarkers[5].content, 'Card fields persona');
assert.equal(messagesWithNativeMarkers[6].content, 'Hello');
assert.equal(messagesWithNativeMarkers[7].content, 'Reply');
assert.ok(!messagesWithNativeMarkers.some((message) => message.content === '世界书占位'));
assert.ok(!messagesWithNativeMarkers.some((message) => message.content === '聊天历史占位'));
assert.ok(!messagesWithNativeMarkers.some((message) => message.content === '扫描时占位'));
