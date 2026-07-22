# Schemes And Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable API, task prompt, preset, and worldbook schemes plus optional streaming API output.

**Architecture:** Put pure snapshot operations in `scheme-utils.js` and pure SSE parsing in `stream-utils.js`, both covered by Node tests. Keep `index.js` responsible for UI state, saving settings, applying schemes to loaded source groups, and streaming preview updates.

**Tech Stack:** Browser JavaScript ES modules, SillyTavern extension settings, OpenAI-compatible `/v1/chat/completions`, Node test files using `node:assert/strict`.

## Global Constraints

- API and task prompt form edits are immediately effective even when not saved as schemes.
- Preset/worldbook generation follows SillyTavern state unless a scheme is loaded.
- Task prompt text scheme is separate from preset placement scheme.
- Auto-injection waits until streaming completes.

---

### Task 1: Scheme Utilities

**Files:**
- Create: `scheme-utils.js`
- Test: `tests/scheme-utils.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `SCHEME_FIELDS`, `normalizeSchemeList(value)`, `captureSchemeSnapshot(type, settings, sourceGroups)`, `saveScheme(list, name, snapshot)`, `deleteScheme(list, id)`, `findScheme(list, id)`

- [x] Write failing tests for API, task, preset, and worldbook snapshots.
- [x] Implement minimal pure helpers.
- [x] Add the test file to `npm test`.

### Task 2: Streaming Utilities

**Files:**
- Create: `stream-utils.js`
- Test: `tests/stream-utils.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `extractStreamDelta(payload)` and `readOpenAiStream(response, onDelta)`

- [x] Write failing tests for OpenAI-compatible chunks and `[DONE]`.
- [x] Implement minimal parser and reader.
- [x] Add the test file to `npm test`.

### Task 3: UI Integration

**Files:**
- Modify: `index.js`
- Modify: `style.css`

**Interfaces:**
- Consumes scheme and stream helpers.

- [x] Add scheme arrays and selected scheme ids to default settings.
- [x] Render scheme controls in API, runtime task, preset, and worldbook cards.
- [x] Move task placement controls from runtime to preset card.
- [x] Wire save-new, overwrite, load, and delete buttons.
- [x] Add streaming checkbox to API settings and request body.
- [x] Update preview as streamed deltas arrive.

### Task 4: Verification And Release

**Files:**
- Modify: `index.js`, `manifest.json`, `package.json`

- [x] Run `npm.cmd test`.
- [x] Run `npm.cmd run check`.
- [x] Bump version to the next patch.
- [ ] Commit and push `main`.
