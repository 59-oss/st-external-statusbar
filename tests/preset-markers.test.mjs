import assert from 'node:assert/strict';
import { collectPresetImportGroups } from '../component-sources.js';

const markerTargetWindow = {
  TavernHelper: {
    getPreset: () => ({
      prompt_order: [{
        order: [
          { identifier: 'worldInfoBefore', enabled: true },
          { identifier: 'charDescription', enabled: true },
          { identifier: 'charPersonality', enabled: true },
          { identifier: 'scenario', enabled: false },
          { identifier: 'chatHistory', enabled: true },
        ],
      }],
      prompts: [
        { identifier: 'custom-system', name: 'Custom System', role: 'system', content: 'Custom prompt' },
      ],
    }),
  },
};

const markerContext = {
  characterId: 0,
  characters: [{
    data: {
      description: '角色描述正文',
      personality: '角色性格正文',
      scenario: '场景正文',
      mes_example: '示例对话正文',
    },
  }],
};

const markerGroups = collectPresetImportGroups({
  targetWindow: markerTargetWindow,
  context: markerContext,
  presetName: 'Marker Preset',
});

assert.deepEqual(
  markerGroups[0].items.slice(0, 5).map((item) => item.markerType),
  ['worldInfoBefore', 'charDescription', 'charPersonality', 'scenario', 'chatHistory'],
);
assert.equal(markerGroups[0].items.find((item) => item.markerType === 'charDescription').content, '角色描述正文');
assert.equal(markerGroups[0].items.find((item) => item.markerType === 'charPersonality').content, '角色性格正文');
assert.equal(markerGroups[0].items.find((item) => item.markerType === 'scenario').enabled, false);
assert.ok(markerGroups[0].items.find((item) => item.markerType === 'chatHistory').content.includes('聊天历史'));

const markerGroupsWithoutHelperPreset = collectPresetImportGroups({
  targetWindow: {
    TavernHelper: {
      getPreset: () => {
        throw new Error('helper preset unavailable');
      },
    },
  },
  context: markerContext,
  presetName: 'Broken Preset',
});

assert.deepEqual(markerGroupsWithoutHelperPreset, [{
  scope: '预设',
  group: '预设：Broken Preset',
  source: 'Broken Preset',
  loaded: true,
  items: [],
}]);
