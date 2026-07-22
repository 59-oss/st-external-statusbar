import assert from 'node:assert/strict';
import { buildExternalStatusbarMessages, createRuntimePromptDiagnostics } from '../prompt-builder.js';

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

const messages = await buildExternalStatusbarMessages({
  targetWindow,
  context,
  latestMessage: { mes: 'Latest assistant prose' },
  taskPrompt: 'Generate footer widgets only.',
  components: [{ scope: 'global', name: 'Choices', content: '<roleplay_options />' }],
});

assert.deepEqual(messages.map((message) => message.role), ['system', 'user', 'user', 'assistant', 'user']);
assert.equal(messages[0].content, 'Write as CharName for UserName.');
assert.ok(messages[1].content.includes('Hello'));
assert.ok(messages[1].content.includes('Reply'));
assert.ok(!messages.some((message) => message.content.includes('SHOULD_NOT_EXIST')));
assert.equal(messages[2].role, 'user');
assert.equal(messages[2].content, 'Hello');
assert.equal(messages[3].role, 'assistant');
assert.equal(messages[3].content, 'Reply');
assert.ok(messages[4].content.includes('Generate footer widgets only.'));
assert.ok(!messages[4].content.includes('<roleplay_options />'));
assert.ok(!messages[4].content.includes('Choices'));
assert.ok(!messages[4].content.includes('Latest assistant prose'));

const messagesWithComponentPlaceholder = await buildExternalStatusbarMessages({
  targetWindow: {},
  context,
  latestMessage: { mes: 'Latest assistant prose' },
  taskPrompt: 'Before\n{{external_components}}\nAfter',
  components: [
    { scope: 'global', name: 'Choices', content: '<roleplay_options />' },
    { scope: 'global', name: 'Guide', content: '<evil_guidance />' },
  ],
  promptSourceItems: [],
});

assert.equal(messagesWithComponentPlaceholder.at(-1).content, 'Before\n<roleplay_options />\n\n<evil_guidance />\nAfter');

const messagesWithoutPresetName = await buildExternalStatusbarMessages({
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

assert.deepEqual(messagesWithoutPresetName.map((message) => message.role), ['user', 'assistant', 'user']);
assert.equal(messagesWithoutPresetName.at(-1).role, 'user');

const messagesFromPresetMarkers = await buildExternalStatusbarMessages({
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
assert.deepEqual(
  messagesFromPresetMarkers.promptSourceItems.map((item) => item.markerType),
  ['charDescription', 'charPersonality', 'scenario', 'dialogueExamples', 'personaDescription', 'chatHistory'],
);

const messagesFromOrderOnlyPresetMarkers = await buildExternalStatusbarMessages({
  targetWindow: {
    TavernHelper: {
      getCurrentPresetName: () => 'Order Only Marker Preset',
      getPreset: () => ({
        prompt_order: [{ character_id: 100001, order: [
          { identifier: 'char-info-open', enabled: true },
          { identifier: 'charDescription', enabled: true },
          { identifier: 'chatHistory', enabled: true },
          { identifier: 'char-info-close', enabled: true },
        ] }],
        prompts: [
          { identifier: 'char-info-open', role: 'system', content: '<char_info>' },
          { identifier: 'char-info-close', role: 'system', content: '</char_info>' },
          { identifier: 'unordered-tail', role: 'system', content: 'SHOULD_NOT_APPEND_TO_END' },
        ],
      }),
    },
  },
  context,
  latestMessage: { mes: 'Latest assistant prose' },
  taskPrompt: 'Generate footer widgets only.',
  components: [],
});

assert.deepEqual(
  messagesFromOrderOnlyPresetMarkers.slice(0, 5).map((message) => message.content),
  ['<char_info>', 'Card fields description', 'Hello', 'Reply', '</char_info>'],
);
assert.ok(!messagesFromOrderOnlyPresetMarkers.some((message) => message.content === 'SHOULD_NOT_APPEND_TO_END'));

const messagesFromPersonaOrder = await buildExternalStatusbarMessages({
  targetWindow: {
    TavernHelper: {
      getCurrentPresetName: () => 'Persona Shell Preset',
      getPreset: () => ({
        prompt_order: [{ character_id: 100001, order: [
          { identifier: 'user-info-open', enabled: true },
          { identifier: 'personaDescription', enabled: true },
          { identifier: 'user-info-close', enabled: true },
        ] }],
        prompts: [
          { identifier: 'user-info-open', role: 'system', content: '<user_info>' },
          { identifier: 'personaDescription', name: 'Persona Description', role: 'system', content: '' },
          { identifier: 'user-info-close', role: 'system', content: '</user_info>' },
        ],
      }),
    },
  },
  context,
  latestMessage: { mes: 'Latest assistant prose' },
  taskPrompt: 'Generate footer widgets only.',
  components: [],
});

assert.deepEqual(
  messagesFromPersonaOrder.slice(0, 3).map((message) => message.content),
  ['<user_info>', 'Card fields persona', '</user_info>'],
);

const messagesFromEmptyRuntimeBlocks = await buildExternalStatusbarMessages({
  targetWindow: {
    TavernHelper: {
      getCurrentPresetName: () => 'Ako Shell Preset',
      getGlobalWorldbookNames: () => ['Global Lore'],
      getCharWorldbookNames: () => ({ primary: 'Character Lore', additional: [] }),
      getChatWorldbookName: () => '',
      getWorldbookNames: () => ['Global Lore', 'Character Lore'],
      getPreset: () => ({
        prompt_order: [{ character_id: 100001, order: [
          { identifier: 'bkgd-open', enabled: true },
          { identifier: 'worldInfoBefore', enabled: true },
          { identifier: 'char-info-open', enabled: true },
          { identifier: 'charDescription', enabled: true },
          { identifier: 'charPersonality', enabled: true },
          { identifier: 'char-info-close', enabled: true },
          { identifier: 'scenario', enabled: true },
          { identifier: 'worldInfoAfter', enabled: true },
          { identifier: 'bkgd-close', enabled: true },
        ] }],
        prompts: [
          { identifier: 'bkgd-open', role: 'system', content: '<bkgd_info>' },
          { identifier: 'worldInfoBefore', role: 'system', content: '' },
          { identifier: 'char-info-open', role: 'system', content: '<char_info>' },
          { identifier: 'char-info-close', role: 'system', content: '</char_info>' },
          { identifier: 'worldInfoAfter', role: 'system', content: '' },
          { identifier: 'bkgd-close', role: 'system', content: '</bkgd_info>' },
        ],
      }),
    },
    SillyTavern: {
      loadWorldInfo: async (name) => ({
        entries: name === 'Global Lore'
          ? {
              0: { uid: 0, content: 'Before character lore', position: { type: 'before_character_definition' }, enabled: true },
              1: { uid: 1, content: 'After character lore', position: { type: 'after_character_definition' }, enabled: true },
            }
          : {
              0: { uid: 0, content: 'Character book after lore', position: 1, enabled: true },
            },
      }),
    },
  },
  context,
  latestMessage: { mes: 'Latest assistant prose' },
  taskPrompt: 'Generate footer widgets only.',
  components: [],
});

assert.deepEqual(
  messagesFromEmptyRuntimeBlocks.slice(0, 9).map((message) => message.content),
  [
    '<bkgd_info>',
    'Before character lore',
    '<char_info>',
    'Card fields description',
    'Card fields personality',
    '</char_info>',
    'Card fields scenario',
    'After character lore\n\nCharacter book after lore',
    '</bkgd_info>',
  ],
);
assert.equal(messagesFromEmptyRuntimeBlocks.runtimeInsertions.charInfoLength > 0, true);
assert.equal(messagesFromEmptyRuntimeBlocks.runtimeInsertions.worldbookBeforeCount, 1);
assert.equal(messagesFromEmptyRuntimeBlocks.runtimeInsertions.worldbookAfterCount, 2);

const messagesFromSelectedSources = await buildExternalStatusbarMessages({
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
    { scope: 'preset', name: 'Ako order 1', role: 'system', content: 'Selected preset prompt' },
    { scope: '\u4e16\u754c\u4e66', name: 'Status lore', content: 'Selected worldbook entry' },
  ],
});

assert.deepEqual(messagesFromSelectedSources.map((message) => message.role), ['system', 'system', 'user']);
assert.equal(messagesFromSelectedSources[0].content, 'Selected preset prompt');
assert.equal(messagesFromSelectedSources[1].content, 'Selected worldbook entry');
assert.ok(!messagesFromSelectedSources.some((message) => message.content.includes('Should not be used')));

const messagesWithTaskAfterPresetSource = await buildExternalStatusbarMessages({
  targetWindow: {},
  context,
  latestMessage: { mes: 'Latest assistant prose' },
  taskPrompt: 'Task after preset B',
  components: [],
  promptSourceItems: [
    { key: 'preset-a', scope: 'preset', name: 'Preset A', role: 'system', content: 'Preset A prompt' },
    { key: 'preset-b', scope: 'preset', name: 'Preset B', role: 'system', content: 'Preset B prompt' },
    { key: 'preset-c', scope: 'preset', name: 'Preset C', role: 'system', content: 'Preset C prompt' },
  ],
  taskPlacement: { enabled: true, afterSourceId: 'preset-b' },
});

assert.deepEqual(
  messagesWithTaskAfterPresetSource.map((message) => message.content),
  ['Preset A prompt', 'Preset B prompt', 'Task after preset B', 'Preset C prompt'],
);

const messagesWithMissingTaskPlacementSource = await buildExternalStatusbarMessages({
  targetWindow: {},
  context,
  latestMessage: { mes: 'Latest assistant prose' },
  taskPrompt: 'Task fallback tail',
  components: [],
  promptSourceItems: [
    { key: 'preset-a', scope: 'preset', name: 'Preset A', role: 'system', content: 'Preset A prompt' },
  ],
  taskPlacement: { enabled: true, afterSourceId: 'missing-preset' },
});

assert.deepEqual(
  messagesWithMissingTaskPlacementSource.map((message) => message.content),
  ['Preset A prompt', 'Task fallback tail'],
);

const messagesFromSelectedSourcesWithMissingMarkers = await buildExternalStatusbarMessages({
  targetWindow: {
    TavernHelper: {
      getCurrentPresetName: () => 'Current Order Preset',
      getPreset: () => ({
        prompt_order: [{ character_id: 100001, order: [
          { identifier: 'bkgd-open', enabled: true },
          { identifier: 'worldInfoBefore', enabled: true },
          { identifier: 'char-info-open', enabled: true },
          { identifier: 'charDescription', enabled: true },
          { identifier: 'char-info-close', enabled: true },
          { identifier: 'worldInfoAfter', enabled: true },
          { identifier: 'bkgd-close', enabled: true },
        ] }],
        prompts: [
          { identifier: 'bkgd-open', role: 'system', content: '<bkgd_info>' },
          { identifier: 'char-info-open', role: 'system', content: '<char_info>' },
          { identifier: 'char-info-close', role: 'system', content: '</char_info>' },
          { identifier: 'bkgd-close', role: 'system', content: '</bkgd_info>' },
        ],
      }),
      getGlobalWorldbookNames: () => ['Runtime Lore'],
      getCharWorldbookNames: () => ({ primary: '', additional: [] }),
      getChatWorldbookName: () => '',
    },
    SillyTavern: {
      loadWorldInfo: async () => ({
        entries: {
          0: { uid: 0, content: 'Runtime before lore', position: { type: 'before_character_definition' }, enabled: true },
          1: { uid: 1, content: 'Runtime after lore', position: { type: 'after_character_definition' }, enabled: true },
        },
      }),
    },
  },
  context,
  latestMessage: { mes: 'Latest assistant prose' },
  taskPrompt: 'Generate footer widgets only.',
  components: [],
  promptSourceItems: [
    { scope: 'preset', name: 'Only selected static prompt', role: 'system', content: 'Selected static prompt' },
  ],
});

assert.deepEqual(
  messagesFromSelectedSourcesWithMissingMarkers.slice(0, 7).map((message) => message.content),
  ['<bkgd_info>', 'Runtime before lore', '<char_info>', 'Card fields description', '</char_info>', 'Runtime after lore', '</bkgd_info>'],
);
assert.equal(messagesFromSelectedSourcesWithMissingMarkers.some((message) => message.content === 'Selected static prompt'), true);
assert.deepEqual(
  messagesFromSelectedSourcesWithMissingMarkers.promptSourceItems.slice(0, 7).map((item) => item.markerType || ''),
  ['', 'worldInfoBefore', '', 'charDescription', '', 'worldInfoAfter', ''],
);

const messagesFromInUsePresetFallback = await buildExternalStatusbarMessages({
  targetWindow: {
    getPreset: (name) => name === 'in_use' ? {
      prompt_order: [{ character_id: 100001, order: [
        { identifier: 'char-info-open', enabled: true },
        { identifier: 'charDescription', enabled: true },
        { identifier: 'char-info-close', enabled: true },
      ] }],
      prompts: [
        { identifier: 'char-info-open', role: 'system', content: '<char_info>' },
        { identifier: 'char-info-close', role: 'system', content: '</char_info>' },
      ],
    } : null,
  },
  context,
  latestMessage: { mes: 'Latest assistant prose' },
  taskPrompt: 'Generate footer widgets only.',
  components: [],
  promptSourceItems: [
    { scope: 'preset', name: 'Only selected static prompt', role: 'system', content: 'Selected static prompt' },
  ],
});

assert.deepEqual(
  messagesFromInUsePresetFallback.slice(0, 3).map((message) => message.content),
  ['<char_info>', 'Card fields description', '</char_info>'],
);
assert.deepEqual(
  createRuntimePromptDiagnostics({
    context,
    promptSourceItems: messagesFromInUsePresetFallback.promptSourceItems,
    runtimeInsertions: messagesFromInUsePresetFallback.runtimeInsertions,
  }).selectedPromptMarkers,
  ['charDescription'],
);

const messagesFromLockedWorldInfoSources = await buildExternalStatusbarMessages({
  targetWindow: {
    TavernHelper: {
      getGlobalWorldbookNames: () => ['Runtime Lore'],
      getCharWorldbookNames: () => ({ primary: '', additional: [] }),
      getChatWorldbookName: () => '',
    },
    SillyTavern: {
      loadWorldInfo: async () => ({
        entries: {
          0: { uid: 0, content: 'Runtime before lore', position: { type: 'before_character_definition' }, enabled: true },
          1: { uid: 1, content: 'Runtime after lore', position: { type: 'after_character_definition' }, enabled: true },
        },
      }),
    },
  },
  context,
  latestMessage: { mes: 'Latest assistant prose' },
  taskPrompt: 'Generate footer widgets only.',
  components: [],
  promptSourceItems: [
    { key: 'bkgd-open', scope: 'preset', name: 'Background start', role: 'system', content: '<bkgd_info>' },
    { key: 'wi-before', scope: 'preset', name: 'World Info (before)', role: 'system', content: '', markerType: 'worldInfoBefore', locked: true },
    { key: 'selected-world', scope: '\u4e16\u754c\u4e66', name: 'Selected flat lore', role: 'system', content: 'Should not flatten into locked marker' },
    { key: 'wi-after', scope: 'preset', name: 'World Info (after)', role: 'system', content: '', markerType: 'worldInfoAfter', locked: true },
    { key: 'bkgd-close', scope: 'preset', name: 'Background end', role: 'system', content: '</bkgd_info>' },
  ],
});

assert.deepEqual(
  messagesFromLockedWorldInfoSources.slice(0, 4).map((message) => message.content),
  ['<bkgd_info>', 'Runtime before lore', 'Runtime after lore', '</bkgd_info>'],
);
assert.ok(!messagesFromLockedWorldInfoSources.some((message) => message.content === 'Should not flatten into locked marker'));

const messagesWithMacroSubstitution = await buildExternalStatusbarMessages({
  targetWindow: {},
  context,
  latestMessage: { mes: 'Latest {{char}} prose' },
  taskPrompt: 'Task for {{user}}\n{{external_components}}',
  components: [{ scope: 'global', name: 'Macro component', content: 'Component for {{char}}' }],
  promptSourceItems: [
    { scope: 'preset', name: 'Macro preset', role: 'system', content: 'Preset for {{char}} and {{user}}' },
  ],
  substituteParams: (content) => String(content).replaceAll('{{char}}', 'CharName').replaceAll('{{user}}', 'UserName'),
});

assert.equal(messagesWithMacroSubstitution[0].content, 'Preset for CharName and UserName');
assert.ok(messagesWithMacroSubstitution.at(-1).content.includes('Task for UserName'));
assert.ok(messagesWithMacroSubstitution.at(-1).content.includes('Component for CharName'));
assert.ok(!messagesWithMacroSubstitution.at(-1).content.includes('Macro component'));

const messagesWithNativeMarkers = await buildExternalStatusbarMessages({
  targetWindow: {},
  context,
  latestMessage: { mes: 'Latest assistant prose' },
  taskPrompt: 'Generate footer widgets only.',
  components: [],
  promptSourceItems: [
    { scope: 'preset', markerType: 'worldInfoBefore', role: 'system', content: 'world placeholder' },
    { scope: '\u4e16\u754c\u4e66', name: 'Lore', role: 'system', content: 'Selected lore text' },
    { scope: 'preset', markerType: 'charDescription', role: 'system', content: 'scan placeholder' },
    { scope: 'preset', markerType: 'charPersonality', role: 'system', content: 'scan placeholder' },
    { scope: 'preset', markerType: 'scenario', role: 'system', content: 'scan placeholder' },
    { scope: 'preset', markerType: 'dialogueExamples', role: 'system', content: 'scan placeholder' },
    { scope: 'preset', markerType: 'personaDescription', role: 'system', content: 'scan placeholder' },
    { scope: 'preset', markerType: 'chatHistory', role: 'system', content: 'history placeholder' },
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
assert.ok(!messagesWithNativeMarkers.some((message) => message.content === 'world placeholder'));
assert.ok(!messagesWithNativeMarkers.some((message) => message.content === 'history placeholder'));
assert.ok(!messagesWithNativeMarkers.some((message) => message.content === 'scan placeholder'));

const runtimeDiagnostics = createRuntimePromptDiagnostics({
  context,
  promptSourceItems: [
    { markerType: 'charDescription', content: '' },
    { markerType: 'charPersonality', content: '' },
    { markerType: 'chatHistory', content: '' },
  ],
});

assert.deepEqual(runtimeDiagnostics.characterFields, {
  characterId: '0',
  descriptionLength: 'Card fields description'.length,
  personalityLength: 'Card fields personality'.length,
  scenarioLength: 'Card fields scenario'.length,
  dialogueExamplesLength: 'Card fields examples'.length,
  personaLength: 'Card fields persona'.length,
});
assert.deepEqual(runtimeDiagnostics.selectedPromptMarkers, ['charDescription', 'charPersonality', 'chatHistory']);
