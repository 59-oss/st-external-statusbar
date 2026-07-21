import assert from 'node:assert/strict';
import { collectSelectedPromptSourceItems, syncPromptSelectionsFromGroups } from '../source-selection.js';

const oldSelections = {
  old_key: true,
  enabled_key: false,
  disabled_key: true,
};

const nextSelections = syncPromptSelectionsFromGroups([
  {
    loaded: true,
    items: [
      { key: 'enabled_key', enabled: true },
      { key: 'disabled_key', enabled: false },
      { key: 'implicit_enabled_key' },
    ],
  },
  {
    loaded: false,
    items: [
      { key: 'unloaded_key', enabled: true },
    ],
  },
], oldSelections);

assert.deepEqual(nextSelections, {
  old_key: true,
  enabled_key: true,
  disabled_key: false,
  implicit_enabled_key: true,
});

const selectedPromptItems = collectSelectedPromptSourceItems([
  {
    loaded: true,
    items: [
      { key: 'preset_system', scope: '预设', name: 'System', role: 'system', content: 'Preset system', enabled: true },
      { key: 'preset_disabled', scope: '预设', name: 'Disabled', role: 'system', content: 'Do not send', enabled: true },
      { key: 'world_enabled_by_default', scope: '世界书', name: 'Lore', content: 'Worldbook lore', enabled: true },
    ],
  },
  {
    loaded: false,
    items: [
      { key: 'unloaded_world', scope: '世界书', name: 'Unloaded', content: 'Should not send yet', enabled: true },
    ],
  },
], {
  preset_disabled: false,
});

assert.deepEqual(selectedPromptItems.map((item) => item.name), ['System', 'Lore']);
assert.equal(selectedPromptItems[0].role, 'system');
