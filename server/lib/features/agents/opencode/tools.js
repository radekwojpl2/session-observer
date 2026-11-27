// OpenCode's tools (lower case): which part of the dashboard's map each belongs to, what role it plays, and where its
// input names a file (filePath).
'use strict';

module.exports = {
  groups: {
    files: ['read', 'write', 'edit', 'glob', 'grep', 'list', 'patch', 'multiedit'],
    shell: ['bash'],
  },
  roles: {
    command: ['bash'],
    subagentCall: ['task'],
    subagent: ['task'],
    question: [],
    asyncQuestion: [],
    task: ['todowrite', 'todoread'],
    patch: [],
  },
  pathFields: ['filePath'],
};
