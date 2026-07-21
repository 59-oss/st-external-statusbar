import assert from 'node:assert/strict';
import { injectStatusbarText, removeLegacyStatusbarBlock } from '../inject-utils.js';

const statusbar = '<roleplay_options>\n...\n</roleplay_options>';

assert.equal(
  injectStatusbarText('正文', statusbar, { mode: 'append' }),
  '正文\n\n<roleplay_options>\n...\n</roleplay_options>',
);

assert.ok(!injectStatusbarText('正文', statusbar, { mode: 'append' }).includes('ST-STATUSBAR'));

assert.equal(
  removeLegacyStatusbarBlock('正文\n\n<!-- ST-STATUSBAR-START -->\n旧状态\n<!-- ST-STATUSBAR-END -->'),
  '正文',
);

assert.equal(
  injectStatusbarText('正文\n\n<!-- ST-STATUSBAR-START -->\n旧状态\n<!-- ST-STATUSBAR-END -->', statusbar, { mode: 'replace' }),
  '正文\n\n<roleplay_options>\n...\n</roleplay_options>',
);
