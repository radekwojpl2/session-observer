// OpenCode (opencode.ai): it has no hook commands, so a plugin runs inside OpenCode (capture/plugin.js, on Bun) and
// translates its plugin hooks and bus events into contract events (translate.js). Each subagent is a session of its
// own, linked to the task call that started it.
'use strict';

module.exports = {
  id: 'opencode',
  name: 'OpenCode', // product names: the same in every language
  shortName: 'OpenCode',
  color: { light: '#2f6f5e', dark: '#6fd1b4' },
  command: 'opencode', // the command word that starts it, to link sessions it starts from a shell call
  capture: 'in-process plugin',
  runtime: 'bun', // the plugin runs in OpenCode's own process, so the dashboard server is started with node
  // none of its own: the plugin's shell.env hook sets OBSERVER_PARENT_AGENT / OBSERVER_PARENT_SESSION, which the
  // recorder reads for every agent
  parentEnv: null,
  reportsContextWindow: true, // the plugin sends the model's window (chat.params) with each step
  statusLineContext: false,
  autocompactBuffer: false,
  contextNoteKey: null,
};
