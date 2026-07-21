import assert from 'node:assert/strict';
import { syncPromptSelectionsFromGroups } from '../source-selection.js';

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
