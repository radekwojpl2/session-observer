// Claude Code's tools: which part of the dashboard's map each belongs to, what role it plays, and where its input
// names a file.
'use strict';

module.exports = {
  groups: {
    files: ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'Glob', 'Grep', 'LS'],
    shell: ['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'KillBash', 'Monitor'],
  },
  roles: {
    command: ['Bash', 'PowerShell'], // runs input.command in a shell
    subagentCall: ['Agent', 'Task'], // starts a subagent
    subagent: ['Agent', 'Task', 'SendMessage'], // counted as subagent activity
    question: ['AskUserQuestion'], // waits for your answer
    asyncQuestion: [], // asks, and also waits for your next message
    task: ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskStop'],
    patch: [], // edits files with a patch in its input
  },
  pathFields: ['file_path', 'notebook_path'], // where a file tool's input names its file
};
