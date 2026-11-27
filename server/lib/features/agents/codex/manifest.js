// Codex: its events come from hook commands (.codex-plugin/plugin.json, or scripts/setup-codex.js → scripts/hook.js
// --agent codex); model steps come from its PostModelRequest events, texts from its rollout file.
'use strict';

module.exports = {
  id: 'codex',
  name: 'Codex',
  shortName: 'Codex',
  color: { light: '#3f4652', dark: '#d4d7dd' },
  command: 'codex',
  capture: 'hook commands',
  // the environment variables a command it runs sees its session (or thread) id and the tool call's id in
  parentEnv: { session: ['CODEX_SESSION_ID', 'CODEX_THREAD_ID'], toolCall: 'CODEX_TOOL_CALL_ID' },
  runtime: 'node',
  reportsContextWindow: true, // its model requests carry model_context_window
  // the window when a request names none (OBSERVER_CODEX_CONTEXT_WINDOW to change it)
  contextWindow: Number(process.env.OBSERVER_CODEX_CONTEXT_WINDOW || 272000),
  statusLineContext: false,
  autocompactBuffer: false, // Codex compacts at its reported window, with no buffer kept free
  contextNoteKey: 'codexContextNote', // shown over its Context view: its session file's format is undocumented
};
