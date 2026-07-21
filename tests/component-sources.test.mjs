import assert from 'node:assert/strict';
import {
  collectComponentImportCandidates,
  collectPresetImportGroups,
  collectWorldbookImportCandidates,
  collectWorldbookImportGroups,
  getActiveComponentsForContext,
  getPresetNamesSafe,
  getWorldbookNamesSafe,
  normalizeComponent,
} from '../component-sources.js';

let worldbookReadCount = 0;
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
    getWorldbook: (name) => {
      worldbookReadCount += 1;
      return name === '状态栏世界书' ? {
        1: { uid: 1, comment: '背包组件', key: ['背包'], content: '<bag>空</bag>' },
      } : {
        2: { uid: 2, comment: '错误世界书条目', content: '<wrong />' },
      };
    },
  },
};

const context = {
  characterId: 0,
  characters: [{ name: '当前角色', data: { description: '角色卡内容' } }],
  extensionPrompts: { injected: { value: '注入内容' } },
  getWorldInfoNames: () => [],
};

assert.deepEqual(getPresetNamesSafe(targetWindow, context), ['Ako 预设']);
assert.deepEqual(getWorldbookNamesSafe(targetWindow, context), ['状态栏世界书']);

worldbookReadCount = 0;
const presetGroups = collectPresetImportGroups({ targetWindow, context });
const worldbookGroups = collectWorldbookImportGroups({ targetWindow, context });
assert.equal(worldbookReadCount, 0);
assert.equal(presetGroups[0].loaded, true);
assert.equal(worldbookGroups[0].loaded, false);
assert.deepEqual(worldbookGroups.map((group) => group.source), ['状态栏世界书']);

const lazyWorldbookItems = await collectWorldbookImportCandidates(targetWindow, '状态栏世界书');
assert.equal(worldbookReadCount, 1);
assert.deepEqual(lazyWorldbookItems.map((item) => item.name), ['背包组件']);

const candidates = await collectComponentImportCandidates({ targetWindow, context });

assert.equal(candidates.length, 2);
assert.deepEqual(candidates.map((item) => item.scope), ['预设', '世界书']);
assert.deepEqual(candidates.map((item) => item.name), ['状态栏格式', '背包组件']);
assert.ok(candidates.every((item) => item.content.includes('<')));
assert.ok(!candidates.some((item) => item.group.includes('角色') || item.source.includes('角色')));
assert.ok(!candidates.some((item) => item.name.includes('错误') || item.source.includes('未挂载')));

const components = [
  { name: '全局状态栏', scope: '全局', content: 'global' },
  { name: '当前预设状态栏', scope: '预设', bindName: 'Ako 预设', content: 'preset-current' },
  { name: '其他预设状态栏', scope: '预设', bindName: '其他预设', content: 'preset-other' },
  { name: '当前角色状态栏', scope: '角色', bindName: '当前角色', content: 'character-current' },
  { name: '其他角色状态栏', scope: '角色', bindName: '其他角色', content: 'character-other' },
  { name: '旧世界书归属', scope: '世界书', content: 'legacy-worldbook-scope' },
  { name: '关闭组件', scope: '全局', enabled: false, content: 'disabled' },
];

assert.equal(normalizeComponent({ scope: '世界书' }, targetWindow, context).scope, '全局');
assert.deepEqual(
  getActiveComponentsForContext(components, targetWindow, context).map((item) => item.name),
  ['全局状态栏', '当前预设状态栏', '当前角色状态栏', '旧世界书归属'],
);
