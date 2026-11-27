// Codex's tools: which part of the dashboard's map each belongs to, what role it plays, and where its input names a
// file. Recent Codex versions report their shell tool as Bash.
'use strict';

module.exports = {
  groups: {
    files: ['apply_patch'],
    shell: ['Bash', 'exec_command', 'shell', 'local_shell'],
  },
  roles: {
    command: ['Bash', 'exec_command', 'shell', 'local_shell'],
    subagentCall: ['spawn_agent'],
    subagent: ['spawn_agent'],
    question: ['request_user_input', 'request_user_input_async'], // the async form also waits for your next message
    task: ['update_plan'],
    patch: ['apply_patch'],
  },
  pathFields: [],
};
