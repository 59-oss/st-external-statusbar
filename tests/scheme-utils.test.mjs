import assert from 'node:assert/strict';
import {
  captureSchemeSnapshot,
  deleteScheme,
  findScheme,
  normalizeSchemeList,
  saveScheme,
} from '../scheme-utils.js';

const settings = {
  apiUrl: 'https://api.example.com/v1',
  apiKey: 'secret',
  apiModel: 'model-a',
  apiModelOptions: ['model-a', 'model-b'],
  maxTokens: '1200',
  temperature: '0.4',
  streamingEnabled: true,
  taskPrompt: 'Task text',
  activeSourcePreset: 'Ako Preset',
  taskPlacementEnabled: true,
  taskPlacementAfterSourceId: 'preset-b',
  promptSelections: {
    preset_a: true,
    world_a: false,
  },
  sourceContentOverrides: {
    preset_a: 'Edited preset',
    world_a: 'Edited world',
  },
};

const groups = [
  { scope: 'preset', source: 'Ako Preset', loaded: true, items: [{ key: 'preset_a', name: 'Preset A' }] },
  { scope: 'world', source: 'World A', loaded: true, items: [{ key: 'world_a', name: 'World A Entry' }] },
];

const apiSnapshot = captureSchemeSnapshot('api', settings, groups, { isWorldbookGroup: (group) => group.scope === 'world' });
assert.deepEqual(apiSnapshot, {
  apiUrl: 'https://api.example.com/v1',
  apiKey: 'secret',
  apiModel: 'model-a',
  apiModelOptions: ['model-a', 'model-b'],
  maxTokens: '1200',
  temperature: '0.4',
  streamingEnabled: true,
});

assert.deepEqual(captureSchemeSnapshot('task', settings, groups).taskPrompt, 'Task text');

const presetSnapshot = captureSchemeSnapshot('preset', settings, groups, { isWorldbookGroup: (group) => group.scope === 'world' });
assert.deepEqual(presetSnapshot, {
  activeSourcePreset: 'Ako Preset',
  taskPlacementEnabled: true,
  taskPlacementAfterSourceId: 'preset-b',
  promptSelections: { preset_a: true },
  sourceContentOverrides: { preset_a: 'Edited preset' },
});

const worldbookSnapshot = captureSchemeSnapshot('worldbook', settings, groups, { isWorldbookGroup: (group) => group.scope === 'world' });
assert.deepEqual(worldbookSnapshot, {
  worldbookSources: ['World A'],
  promptSelections: { world_a: false },
  sourceContentOverrides: { world_a: 'Edited world' },
});

const firstSave = saveScheme([], 'Daily', apiSnapshot);
assert.equal(firstSave.length, 1);
assert.equal(firstSave[0].name, 'Daily');
assert.ok(firstSave[0].id);

const overwritten = saveScheme(firstSave, 'Daily v2', { apiUrl: 'next' }, firstSave[0].id);
assert.equal(overwritten.length, 1);
assert.equal(findScheme(overwritten, firstSave[0].id).snapshot.apiUrl, 'next');
assert.equal(findScheme(overwritten, firstSave[0].id).name, 'Daily v2');

assert.deepEqual(deleteScheme(overwritten, firstSave[0].id), []);
assert.deepEqual(normalizeSchemeList(null), []);
