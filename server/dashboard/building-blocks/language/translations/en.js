'use strict';
// Session Observer dashboard — English, the reference table: every other language has exactly these keys (test/check.js).
TRANSLATIONS.en = (() => {
  const noun = (...forms) => pluralNoun('en', ...forms);
  return {
    decimalSeparator: '.', // decimal separator
    count: (number, noun) => `${number} ${noun}`, // a count and its noun (Japanese and Korean put the noun first)
    units: { ms: 'ms', s: 's', m: 'm', h: 'h', d: 'd' }, // duration units, written right after the number
    ago: x => `${x} ago`,
    // nouns with a count in front: countOf(3, 'tool') → "3 tools"
    nouns: {
      tool: noun('tool', 'tools'), toolCall: noun('tool call', 'tool calls'), call: noun('call', 'calls'), step: noun('step', 'steps'),
      modelStep: noun('model step', 'model steps'), turn: noun('turn', 'turns'), problem: noun('problem', 'problems'), edit: noun('edit', 'edits'),
      read: noun('read', 'reads'), run: noun('run', 'runs'), program: noun('program', 'programs'), subagent: noun('subagent', 'subagents'),
      prompt: noun('prompt', 'prompts'), skill: noun('skill', 'skills'), plugin: noun('plugin', 'plugins'), mcpServer: noun('MCP server', 'MCP servers'),
      item: noun('item', 'items'),
    },
    groups: { you: 'You', model: 'Model', files: 'Files', shell: 'Shell', git: 'Git', mcp: 'MCP', network: 'Network', browser: 'Browser', agents: 'Agents', skills: 'Skills', context: 'Context', other: 'Other' },
    categories: {
      model: 'Model', prompt: 'Prompt', tool: 'Tool', skill: 'Skill', question: 'Question', subagent: 'Subagent',
      task: 'Task', mcp: 'MCP', permission: 'Permission', error: 'Error', notification: 'Notice',
      compact: 'Compact', context: 'Context', lifecycle: 'Lifecycle', env: 'Env',
    },
    views: { home: 'Home', overview: 'Overview', route: 'Route', chat: 'Chat', context: 'Context' },
    themes: { auto: 'auto', dark: 'dark', light: 'light' },

    // header and filters (the page's own text)
    language: 'Language', settings: 'Settings', langAuto: 'Auto',
    githubTitle: 'Session Observer on GitHub', reportIssue: 'Report an issue', releaseNotes: 'Click to see what changed in this version.',
    verTitle: 'Version of the running server. It keeps running after a plugin update until it is restarted, so an older number here means an old server.',
    connTitle: 'Live connection to the local server', connecting: 'connecting…', live: 'live', disconnected: 'disconnected',
    lastUpdate: t => ` · last update ${t}`,
    busyTitle: 'Sessions currently in the middle of a turn', working: n => `${n} working`,
    freezeTitle: 'Freeze the screen; new events are buffered and applied when you resume',
    freeze: 'Freeze', unfreeze: n => `Unfreeze${n ? ` (${n} new)` : ''}`,
    theme: v => `Theme: ${v}`,
    clearLog: 'Clear log', clearLogTitle: 'Delete the local event log', clearConfirm: 'Delete all recorded events?',
    // the Notify menu in the header, and the desktop notifications it turns on
    // the keyboard shortcuts dialog (? in the header)
    shortcuts: {
      title: 'Keyboard shortcuts', buttonTitle: 'Keyboard shortcuts (?)', close: 'Close', or: 'or', dashboard: 'Dashboard',
      nextSession: 'Next session', prevSession: 'Previous session', allSessions: 'All activity', needsYouSession: 'Next session that needs you',
      nextTurn: 'Next turn', prevTurn: 'Previous turn', closeTurn: 'Close the turn, or leave the search', search: 'Search', views: 'Switch view', help: 'Show or hide this list',
      claudeCode: 'Claude Code',
      claudeCodeNote: 'Common keys from the Claude Code docs; they can change between versions. On macOS, Alt is Option (some need Option set as Meta in the terminal).',
      fullList: 'Full list',
      ccInterrupt: 'Interrupt, or clear the prompt; press twice to exit',
      ccEsc: 'Interrupt Claude, or close a dialog',
      ccRewind: 'Clear the prompt; on an empty prompt, go back to an earlier point',
      ccModes: 'Cycle the permission modes, plan mode among them',
      ccTranscript: 'Show or hide the transcript',
      searchHistory: 'Search earlier prompts',
      ccBackground: 'Send a running command or agent to the background',
      ccTasks: 'Show or hide the task list',
      ccEditor: 'Write the prompt in your text editor',
      ccStash: 'Set the prompt aside, or bring it back',
      ccImage: 'Paste an image (Alt+V on Windows)',
      ccModel: 'Switch the model',
      newline: 'New line in the prompt',
      ccSlash: 'Run a command or a skill',
      ccShell: 'Shell mode: run a command; Claude sees its output',
      mention: 'Add a file by its path',
      ccHelp: 'All shortcuts (on an empty prompt)',
    },
    alerts: {
      modes: { off: 'Notify: off', needsYou: 'Notify: needs you', alsoDone: 'Notify: also when done' },
      title: 'Desktop notifications while this window is not in focus',
      blocked: 'The browser blocks notifications for this page. Allow them in the site settings.',
      needsYou: n => `${n} needs you`, done: n => `${n} is done`, doneBody: 'It waits for your next prompt.',
    },
    // a session's context filled past a threshold (features/context-alerts)
    contextAlerts: {
      title: (n, p) => `${n}: context past ${p}%`, body: s => `Context is at ${s}.`, bodyJump: (s, j) => `Context is at ${s}, ${j} in one step.`,
      open: 'Go to turn', close: 'Close',
    },
    deleteSessionTitle: 'Delete this session and its stored data',
    deleteSessionConfirm: name => `Delete “${name}” and its stored Session Observer data? The original app transcript will stay. This cannot be undone.`,
    deleteSessionFailed: reason => `Could not delete the session: ${reason}`,
    openSession: 'Open this session', startedBy: 'started by', startedSessions: n => (n === 1 ? 'Started session' : 'Started sessions'),
    loadOlderSessions: day => `Load sessions before ${day}`,
    loadOlderTitle: 'Older days are saved but not loaded yet',
    sessionOrder: 'Order', sessionOrderTitle: 'How the sessions list is ordered. Only "last activity" reshuffles it while sessions work.',
    orderStarted: 'newest started', orderActivity: 'last activity', orderName: 'name', orderProject: 'project', noProject: '(no folder)',
    range: 'Range', range1h: 'last 1 h', range6h: 'last 6 h', range24h: 'last 24 h', range7d: 'last 7 d', rangeAll: 'everything',
    search: 'Search', searchPh: 'prompts, replies, commands, paths, errors…',
    group: 'Tool group', groupTitle: 'Which part of the map: Files, Shell, Git, MCP…', allGroups: 'all groups', agent: 'Agent', allAgents: 'all agents', agentTitle: 'Show sessions from Claude Code, Codex or both',
    onlyProblems: 'only problems', filters: 'Filters', resetFilters: 'Reset filters', view: 'View',

    // shared words
    subagent: 'Subagent', subagentLc: 'subagent', mainAgent: 'Main agent', mainAgentLc: 'main agent',
    turn: 'Turn', turnN: n => `Turn ${n}`, sessionStart: 'Session start',
    running: 'running', runningEll: 'running…', workingEll: 'working…', failedLc: 'failed', unfinished: 'unfinished',
    promptLc: 'prompt', tokens: 'tokens', outX: x => `${x} out`, outTokens: x => `${x} output tokens`,
    ofPct: (a, b, p) => `${a} of ${b} (${p}%)`, ctxLc: 'context', nowLc: 'now',
    expandTurn: 'Expand this turn', collapseTurn: 'Collapse this turn', expand: 'Expand', collapse: 'Collapse',
    noOutput: 'no output', input: 'Input', output: 'Output', error: 'Error', prompt: 'Prompt',

    // what an event is: [label, detail] in rows, tooltips and route stops
    event: {
      calls: l => `calls ${l}`, replied: 'replied', thought: 'thought', thinking: 'thinking', expanded: 'Expanded',
      answered: 'answered', failed: 'failed', permission: 'Permission', asked: 'asked', denied: 'Denied', deniedLc: 'denied',
      message: 'Message', turn: 'Turn', done: 'done', turnFailed: 'Turn failed', turnFailedLc: 'turn failed',
      started: 'started', finished: 'finished', created: 'created', completed: 'completed', session: 'Session', ended: 'ended',
      compacting: 'compacting', compacted: 'compacted', memory: 'Memory', mcpAsks: 'MCP asks', answeredMcp: 'answered MCP',
      modelSwitch: 'Model switch', modelSwitched: 'Model switched', file: 'File', changed: 'changed', config: 'Config',
      directory: 'Directory', added: 'added', via: 'via', worktree: 'Worktree', removed: 'removed', setup: 'Setup',
      teammate: 'Teammate', idle: 'idle',
      startedSession: 'started', createdWorktree: 'created', changedConfig: 'changed', // Session, Worktree and Config get their own words: in some languages the past participle agrees with the noun
    },

    // sessions panel
    sessionState: { needsYou: 'needs you', yourTurn: 'your turn', ended: 'ended', working: 'working', live: 'live', inactive: 'inactive' },
    needYouN: n => `Needs you: ${n}`,
    home: {
      pinned: 'Pinned sessions', pinSession: 'Pin session', unpinSession: 'Unpin session',
      pinFailed: reason => `Could not update the session pin: ${reason}`,
      needsYou: 'Needs you', allClear: 'Nothing needs you right now.',
      permission: t => (t ? `Permission to use ${t}` : 'Permission needed'), question: 'Question for you', mcp: s => `${s || 'An MCP server'} asks for input`,
      inSubagent: t => `in subagent ${t}`, noSessions: 'No sessions in this range.', done: 'done', more: n => `+${n} more`, open: 'Open this session',
    },
    allActivity: 'All activity', everySession: 'every session combined', sessions: 'Sessions', lastLbl: 'last:',
    ctxWindow: 'context window', ctxShort: 'ctx', noSessions: 'No sessions in this range.',

    // overview
    tiles: {
      sessions: 'Sessions', turns: 'Turns', toolCalls: 'Tool calls', modelSteps: 'Model steps', problems: 'Problems',
      failedOrDenied: 'failed or denied', outputTokens: 'Output tokens', subagents: 'Subagents', duration: 'Duration',
      context: 'Context', tokens: 'Tokens',
    },
    allLead: r => `Every session in ${r}. Pick a session on the left to see only its work.`,
    sessionNotFound: 'Session not found.', endedX: r => `ended ${r}`, inTools: d => `${d} in tools`, tokSub: o => `in · ${o} out`,
    filtered: 'filtered', turns: 'Turns', noTurnsMatch: 'No turns match.', sessionStartParen: '(session start)',
    turnChartAria: 'Duration of each turn', lastNShown: n => `(last ${n} shown)`,
    turnChartHint: 'bar height = how long it ran · ✕ had problems · click a bar to open it',
    notEnoughSteps: 'Not enough model steps yet.', ctxChartKey: 'dashed = window, dotted = 80%', ctxChartAria: 'Context tokens over time',
    activityByGroup: 'Activity by group', noActivity: 'No activity yet.',
    groupSub: (a, idle) => `${a} active${idle ? ` · ${idle} idle hidden` : ''} · bars = last 15 min · click to filter`,
    lastX: x => `last: ${x}`, barsHint: l => `bars: last 15 min · click to filter to ${l}`,
    files: 'Files', noFiles: 'No files read or edited.', filesSub: (n, top) => `${n} touched · top ${top}`, openLatest: 'click to open the latest call',
    commands: 'Commands', noCommands: 'No shell commands.', topN: n => `top ${n}`, latestX: x => `latest: ${x}`,
    subagents: 'Subagents', startedAt: t => `started ${t}`, problems: 'Problems', latestFirst: 'latest first',

    // chat
    noConversation: 'No conversation yet', openTurn: 'Open this turn', agentWorking: name => `${name} is working…`, codexContextNote: 'Read from Codex\'s own session file, whose format is not documented and can change, so some parts may be missing. Codex stores reasoning encrypted: it counts in the totals, but its text is not shown.',

    // event types
    eventTypes: 'Event types',

    // route
    backX: d => `back · ${d}`,
    ctxEndTip: o => `Context at the end of this turn: ${o}`, ctxChangeTip: (d, comp) => `Change from the previous turn: ${d}${comp ? ' (compacted)' : ''}`,
    noTurnsRoute: 'No turns yet — the next prompt draws its route here.',
    runningX: (what, d) => `running ${what} · ${d}`, subagentsWorking: n => `${n} ${n === 1 ? 'subagent' : 'subagents'} working`,
    waitingPermission: 'waiting for your permission', modelGenerating: d => `model generating · ${d} since last step`,
    nowLbl: 'Now:', prevTurn: '‹ Previous turn', nextTurn: 'Next turn ›', turnOf: (i, n) => `Turn ${i} of ${n}`,
    backToLatest: 'Back to latest ⟳', showingLatest: 'showing the latest turn · updates live',

    // details panel
    details: 'Details',
    detailResize: 'Resize Details', detailResizeTitle: 'Drag to resize Details. Double-click: default width. Keys: ← / →', detailShowTitle: 'Show Details', detailHideTitle: 'Hide Details', detailWideTitle: 'Widen Details over the view', detailNarrowTitle: 'Put Details back at the side',
    pickTurn: 'Pick a turn: a bar on the Overview\'s Turns chart, a stop on the Route, or a message in the Chat. Keys: <b>[</b> / <b>]</b> previous / next turn, <b>Esc</b> close.',
    prevTitle: 'Previous turn ([)', prev: '‹ Prev', nextTitle: 'Next turn (])', next: 'Next ›', closeTitle: 'Close (Esc)', close: 'Close',
    reply: 'Reply', events: 'Events', newestFirst: 'newest first', noPrompt: 'Session start (no prompt)',
    eventsCtxHint: '▸ opens a row, a click on the row shows it in Context', eventsHint: 'click a row for its details',
    langsInTurn: 'Languages and tools in this turn', colourKey: 'Colour key', failedDenied: 'failed / denied', modelReply: 'model reply',
    effortX: x => `effort ${x}`, modeX: x => `mode ${x}`, rawPayload: 'Raw payload',
    hookEvents: 'Hook events', notReceived: 'not received', notYet: 'not yet (still running)', askedByModel: t => `asked for by the model at ${t}`,
    wrote: 'wrote', sentPrompt: 'sent a prompt', promptExpanded: 'Prompt expanded', typed: 'Typed', expandedTo: 'Expanded to',
    turnFinished: 'Turn finished', turnFailed: 'Turn failed', stopHookActive: 'stop hook active', finalReply: 'Final reply',
    stillRunning: 'Still running in the background', taskGiven: 'Task it was given', finalMessage: 'Its final message',
    permissionAsked: 'Permission asked', permissionDenied: 'Permission denied', forThisCall: 'For this call', notification: 'Notification',
    sessionStarted: 'Session started', sessionEnded: 'Session ended', toolBatch: 'Tool batch finished', messageShown: 'Message shown',
    final: 'final', partX: x => `part ${x}`, configChanged: 'Config changed', dirAdded: 'Directory added', viaX: x => `via ${x}`,
    worktreeCreated: 'Worktree created', worktreeRemoved: 'Worktree removed', cwdChanged: 'Working directory changed',
    switchingModel: 'Switching model', modelSwitched: 'Model switched', resendCost: x => `≈ $${x} to re-send the context`, yes: 'yes', no: 'no',
    fields: {
      file: 'file', replaceAll: 'replace all', description: 'description', type: 'type', model: 'model', lines: 'lines', status: 'status',
      agent: 'agent', async: 'async', tasks: 'tasks', crons: 'crons', transcript: 'transcript', directory: 'directory', path: 'path',
      from: 'from', to: 'to', requested: 'requested', contextTokens: 'context tokens', cacheWarm: 'cache warm', cost: 'cost',
    },
    linesOf: (a, b, n) => `${a}–${b} of ${n}`, interruptedByUser: 'interrupted by the user', interrupted: 'interrupted',
    applied: 'applied', appliedChanged: 'applied, then changed by the user', noAnswers: 'no answers',
    notificationTypes: {
      idle_prompt: 'waiting for your input', permission_prompt: 'needs your permission', auth_success: 'signed in', auth_storage_failure: 'could not store sign-in',
      elicitation_dialog: 'MCP server is asking for input', elicitation_url_dialog: 'MCP server wants you to open a link', elicitation_complete: 'MCP input done', elicitation_response: 'MCP input answered',
      agent_needs_input: 'an agent needs your input', agent_completed: 'an agent finished', plugin_notification: 'from a plugin',
      quota_auto_resume_fired: 'resumed after the usage limit', quota_auto_resume_stale: 'auto-resume skipped (stale)', quota_auto_resume_disabled: 'auto-resume is off',
    },
    stopReasons: { tool_use: 'stopped to call tools', end_turn: 'finished its reply', max_tokens: 'hit the output token limit', stop_sequence: 'hit a stop sequence', pause_turn: 'paused a long-running turn', refusal: 'refused' },
    noStopReason: 'no stop reason (still writing, or an intermediate line)',
    toolsAsked: 'Tools it asked for', matchedByOrder: '(matched by order; older log)', noHookEvent: 'no hook event',
    toolNotLogged: 'Asked for a tool, but the call isn\'t in the log yet.', whatItWrote: 'What it wrote',
    cacheRead: 'read from cache', cacheWrite: 'written to cache', uncached: 'uncached input', outputLc: 'output',

    // context view
    approxTokens: x => `≈${x} tokens`, claude: 'Claude', taskAndResults: 'Task and results', showInDetails: 'Show this message in Details',
    compacted: 'Compacted', atTokens: x => `at ${x} tokens`,
    replacedBelow: 'everything below was replaced by the summary above', replacedAbove: 'everything above was replaced by the summary below',
    compactionSummary: 'Compaction summary', thinking: 'thinking', injected: 'injected', attachment: 'attachment',
    notSentModel: 'not sent to the model', pinnedChange: 'change to a list pinned on top', sentAsText: 'sent as text made from this data',
    sentModel: 'sent to the model', notSent: 'not sent', result: 'result', toolResult: 'tool result',
    ownContext: x => `its own context, ${x}`, afterCompaction: 'After compaction', beforeFirstPrompt: 'Before the first prompt',
    showTurnInDetails: 'Show this turn in Details', inDetails: 'in Details', detailsGo: 'Details ›',
    instructionKinds: { User: 'global, ~/.claude', Project: 'project', Local: 'local, not checked in', AutoMem: 'auto-memory', Managed: 'managed policy' },
    measuredNote: (first, cpt) => `Measured: the first request was ${first} tokens (system prompt, tools, instructions, listings and the first prompt). ${cpt
      ? `Sizes on cards use this session's average of ${cpt} characters per token.` : 'Sizes on cards are estimates at about 4 characters per token.'}`,
    systemPrompt: 'System prompt', charsN: x => `${x} chars`, toolDefs: 'Tool definitions', builtIn: 'Built-in',
    noSystem: 'The system prompt and tool definitions are not in this transcript: Claude Code records them only in some versions. Everything below is.',
    instructions: 'Instructions',
    noInstructions: 'No instruction files in this transcript: no CLAUDE.md (global, project or local), AGENTS.md, rules or auto-memory were loaded.',
    skills: 'Skills', skillsNote: 'Name and description only: a skill\'s SKILL.md enters the context when it is invoked.',
    notFromPlugin: 'Not from a plugin', claudeSync: 'claude.ai sync', pluginLc: 'plugin', subagentTypes: 'Subagent types',
    noDescription: 'no description', mcpInstructions: 'MCP server instructions', deferredTools: 'Deferred tools',
    deferredSub: (n, loaded) => `${n} known by name, ${loaded} loaded`, failedX: x => `${x} failed`,
    deferredNote: 'Only the names are in the context; a tool\'s definition loads through ToolSearch when needed. Highlighted names have been loaded.',
    failedConnect: 'failed to connect', loadedN: n => `${n} loaded`, loadedLc: 'loaded', nameOnly: 'name only, loads on demand',
    usageCategories: {
      sys: 'System prompt', tools: 'System tools', mcpt: 'MCP tools', mcpi: 'MCP server instructions', mem: 'Memory files', skills: 'Skills',
      agents: 'Subagent types', defer: 'Deferred tool names', msgs: 'Messages', msgsAll: 'Messages, system prompt and tools',
    },
    showBelow: 'Show it below', freeSpace: 'Free space', autocompact: 'Autocompact buffer', cellsTitle: '200 cells, each 0.5% of the window',
    modelUnknown: 'model unknown', usageByCat: 'Estimated usage by category', ctxUsage: 'Context usage',
    cuNote: (cpt, known) => `Like Claude Code's /context. The total is measured at the latest model step; the parts are estimated from their text${cpt
      ? ` at this session's ${cpt} characters per token` : ' at about 4 characters per token'}, and Messages is the rest. Click a category to see it below.${known ? '' : ' This transcript has no system prompt or tool definitions, so they are counted in Messages.'}`,
    wholeSession: 'Whole session', sinceCompaction: 'Since last compaction',
    notCompacted: 'This session has not been compacted, so the whole session is the current context',
    msgOrder: 'Message order', newestFirstBtn: 'Newest first', oldestFirstBtn: 'Oldest first',
    bookkeepingTitle: 'Records Claude Code keeps in the transcript for itself; they are never sent to the model', bookkeeping: 'bookkeeping',
    ctxNow: 'context now', expandTurns: 'Expand turns', collapseTurns: 'Collapse turns', expandAll: 'Expand all', collapseAll: 'Collapse all',
    copyTitle: 'Copy everything shown as Markdown', copy: 'Copy', copied: 'Copied', copyFailed: 'Copy failed',
    showingMatches: q => `Showing what matches “${q}”. Reset filters to see everything.`, nothingYet: 'Nothing here yet',
    pickSession: 'Pick a session on the left to see its whole context.', readingTranscript: 'Reading the transcript…',
    cantRead: err => `Could not read this session's transcript${err ? `: ${err}` : ''}.`,
  };
})();
