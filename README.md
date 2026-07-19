# External Statusbar Generator

SillyTavern third-party extension scaffold for an external end-of-message statusbar generator.

Current state:

- Local project skeleton created.
- `manifest.json` is set up for SillyTavern third-party extension installation.
- `index.js` has a starter `GENERATION_ENDED` listener and message-end injection placeholder.
- The injected block uses stable sentinels so later generations can replace the existing statusbar instead of duplicating it.

Planned MVP:

- Auto generate + auto inject.
- Auto generate + manual inject.
- Manual generate + manual inject.
- Optional independent OpenAI-compatible API settings.
- Editable task instruction.
- Global / preset / character component libraries.
- User-configurable output tag cleanup.
