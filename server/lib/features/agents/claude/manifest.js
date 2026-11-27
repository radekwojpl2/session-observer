// Claude Code: its events come from hook commands (hooks/hooks.json → scripts/hook.js), and the server reads model
// steps and texts from its transcript.
'use strict';

module.exports = {
  id: 'claude',
  name: 'Claude Code', // product names: the same in every language
  shortName: 'Claude', // over its replies in the chat
  color: { light: '#b4532a', dark: '#e8875f' },
  command: 'claude', // the command word that starts it, to link sessions it starts from a shell call
  capture: 'hook commands',
  // the environment variable a command it runs sees its session id in: a session started there is its child
  parentEnv: { session: ['CLAUDE_CODE_SESSION_ID'] },
  runtime: 'node',
  reportsContextWindow: false, // its context window is inferred from the model
  statusLineContext: true, // its status line reports the real window (scripts/claude-statusline.js)
  autocompactBuffer: true, // Claude Code keeps a buffer free for compaction, shown in the Context view
  contextNoteKey: null,
};
