'use strict';
// Session Observer dashboard — keyboard shortcuts: the list the shortcuts dialog shows, one section per tab.
// A row's keys: each entry is one way to do it ("or" between entries); "+" joins keys pressed together, a space keys
// pressed one after the other. `what` is the TEXT.shortcuts key that says what they do.
// The dashboard's own keys are handled in features/shortcuts/controls.js and features/details/controls.js. The Claude
// Code keys are the common ones from its docs (`docs`); Claude Code can change them, so the dialog links there.
const SHORTCUT_SECTIONS = [
  {
    id: 'dashboard',
    rows: [
      { keys: ['j', ']'], what: 'nextTurn' },
      { keys: ['k', '['], what: 'prevTurn' },
      { keys: ['Esc'], what: 'closeTurn' },
      { keys: ['Shift+J'], what: 'nextSession' },
      { keys: ['Shift+K'], what: 'prevSession' },
      { keys: ['0'], what: 'allSessions' },
      { keys: ['u'], what: 'needsYouSession' },
      { keys: ['/'], what: 'search' },
      { keys: ['1–6'], what: 'views' },
      { keys: ['?'], what: 'help' },
    ],
  },
  {
    id: 'claudeCode',
    docs: 'https://code.claude.com/docs/en/interactive-mode',
    rows: [
      { keys: ['Ctrl+C'], what: 'ccInterrupt' },
      { keys: ['Esc'], what: 'ccEsc' },
      { keys: ['Esc Esc'], what: 'ccRewind' },
      { keys: ['Shift+Tab'], what: 'ccModes' },
      { keys: ['Ctrl+O'], what: 'ccTranscript' },
      { keys: ['Ctrl+R'], what: 'searchHistory' },
      { keys: ['Ctrl+B'], what: 'ccBackground' },
      { keys: ['Ctrl+T'], what: 'ccTasks' },
      { keys: ['Ctrl+G'], what: 'ccEditor' },
      { keys: ['Ctrl+S'], what: 'ccStash' },
      { keys: ['Ctrl+V', 'Alt+V'], what: 'ccImage' },
      { keys: ['Alt+P'], what: 'ccModel' },
      { keys: ['Ctrl+J', '\\ Enter', 'Shift+Enter'], what: 'newline' },
      { keys: ['/'], what: 'ccSlash' },
      { keys: ['!'], what: 'ccShell' },
      { keys: ['@'], what: 'mention' },
      { keys: ['?'], what: 'ccHelp' },
    ],
  },
];
