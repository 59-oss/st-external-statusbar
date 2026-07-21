import assert from 'node:assert/strict';
import { collectComponentImportCandidates, getPresetNamesSafe, getWorldbookNamesSafe } from '../component-sources.js';

const targetWindow = {
  getPresetManager: () => ({ getSelectedPresetName: () => 'Ako 预设' }),
  TavernHelper: {
    getPresetNames: () => ['Ako 预设', '不应扫描的旧预设'],
    getPreset: (name) => name === 'Ako 预设' ? {
      prompts: [
        { id: 'statusbar-format', name: '状态栏格式', content: '<status>HP: {{value}}</status>' },
        { id: 'empty', name: '空条目', content: '' },
      ],
    } : { prompts: [{ id: 'wrong', name: '错误预设条目', content: '<wrong />' }] },
    getWorldbookNames: () => ['状态栏世界书', '不应扫描的未挂载世界书'],
    getGlobalWorldbookNames: () => ['状态栏世界书'],
    getCharWorldbookNames: () => ({ primary: '', additional: [] }),
    getChatWorldbookName: () => '',
    getWorldbook: (name) => name === '状态栏世界书' ? {
      1: { uid: 1, comment: '背包组件', key: ['背包'], content: '<bag>空</bag>' },
    } : {
      2: { uid: 2, comment: '错误世界书条目', content: '<wrong />' },
    },
  },
};

const context = {
  characters: [{ name: '不应该出现的角色', data: { description: '角色卡内容' } }],
  extensionPrompts: { injected: { value: '注入内容' } },
  getWorldInfoNames: () => [],
};

assert.deepEqual(getPresetNamesSafe(targetWindow, context), ['Ako 预设']);
assert.deepEqual(getWorldbookNamesSafe(targetWindow, context), ['状态栏世界书']);

const candidates = await collectComponentImportCandidates({ targetWindow, context });

assert.equal(candidates.length, 2);
assert.deepEqual(candidates.map((item) => item.scope), ['预设', '世界书']);
assert.deepEqual(candidates.map((item) => item.name), ['状态栏格式', '背包组件']);
assert.ok(candidates.every((item) => item.content.includes('<')));
assert.ok(!candidates.some((item) => item.group.includes('角色') || item.source.includes('角色')));
assert.ok(!candidates.some((item) => item.name.includes('错误') || item.source.includes('未挂载')));
