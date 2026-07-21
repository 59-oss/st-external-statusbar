import assert from 'node:assert/strict';
import { collectComponentImportCandidates } from '../component-sources.js';

const targetWindow = {
  TavernHelper: {
    getPresetNames: () => ['Ako 预设'],
    getPreset: (name) => name === 'Ako 预设' ? {
      prompts: [
        { id: 'statusbar-format', name: '状态栏格式', content: '<status>HP: {{value}}</status>' },
        { id: 'empty', name: '空条目', content: '' },
      ],
    } : null,
    getWorldbookNames: () => ['状态栏世界书'],
    getWorldbook: (name) => name === '状态栏世界书' ? {
      1: { uid: 1, comment: '背包组件', key: ['背包'], content: '<bag>空</bag>' },
    } : {},
  },
};

const context = {
  characters: [{ name: '不应该出现的角色', data: { description: '角色卡内容' } }],
  extensionPrompts: { injected: { value: '注入内容' } },
  getWorldInfoNames: () => [],
};

const candidates = await collectComponentImportCandidates({ targetWindow, context });

assert.equal(candidates.length, 2);
assert.deepEqual(candidates.map((item) => item.scope), ['预设', '世界书']);
assert.deepEqual(candidates.map((item) => item.name), ['状态栏格式', '背包组件']);
assert.ok(candidates.every((item) => item.content.includes('<')));
assert.ok(!candidates.some((item) => item.group.includes('角色') || item.source.includes('角色')));
