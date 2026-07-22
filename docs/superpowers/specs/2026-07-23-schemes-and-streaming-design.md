# Schemes And Streaming Design

API and task prompt fields always use the currently visible form values. Their schemes are shortcuts for saving, loading, overwriting, and deleting reusable form snapshots.

Preset and worldbook schemes store reusable source selections. Without a loaded scheme, generation follows the current SillyTavern preset and currently active worldbooks, with task prompt placement appended at the end. Loading a preset scheme switches the source preset selector back to the saved preset, reloads its source rows, restores preset item selections and content overrides, and restores task prompt placement. Loading a worldbook scheme reloads saved worldbooks when they are available and restores their item selections and content overrides.

Streaming belongs to API settings and API schemes. When enabled, requests include `stream: true`, OpenAI-compatible SSE chunks are read incrementally, and the generated preview updates as text arrives. Auto-injection still waits for the stream to finish.
