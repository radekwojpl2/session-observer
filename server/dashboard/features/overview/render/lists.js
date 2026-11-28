'use strict';
// Session Observer dashboard — Overview lists: the files worked on, shell commands, subagents and problems.
const LIST_ROWS_MAX = 8;

const listHtml = rows => `<div class="vlist">${rows.join('')}</div>`;
const noneHtml = text => `<div class="none">${escapeHtml(text)}</div>`;
// "<b>3</b> edits" in the language's order
const boldCount = (count, nounOf) => TEXT.count(`<b>${count}</b>`, escapeHtml(nounOf(count)));

// paths relative to the session's folder when inside it; a long folder keeps its last part
function pathParts(scopeFolder) {
  const relative = filePath => (scopeFolder && filePath.startsWith(scopeFolder + '/') ? filePath.slice(scopeFolder.length + 1) : filePath);
  return filePath => {
    const path = relative(filePath), folder = path.slice(0, Math.max(0, path.length - baseName(path).length));
    return folder.length > 36 ? '…' + folder.slice(-35) : folder;
  };
}

// ---- the files the agent worked on most
function filesListHtml(events) {
  const byPath = new Map();
  for (const event of events) {
    const tool = event.data?.tool_name;
    // a tool that reads or changes the file it names (a search tool names a folder or a pattern, not a file worked on)
    if (event.event !== 'PreToolUse' || !(READ_TOOLS.has(tool) || EDIT_TOOLS.has(tool))) continue;
    for (const filePath of filesOfToolCall(tool, event.data.tool_input || {})) {
      const file = byPath.get(filePath) || { reads: 0, writes: 0, seq: event.seq };
      file.seq = event.seq; // the latest call
      if (READ_TOOLS.has(tool)) file.reads++;
      else file.writes++;
      byPath.set(filePath, file);
    }
  }
  const top = [...byPath.entries()].sort((a, b) => (b[1].reads + b[1].writes) - (a[1].reads + a[1].writes)).slice(0, LIST_ROWS_MAX);
  if (!top.length) return overviewCardHtml(TEXT.files, '', noneHtml(TEXT.noFiles));
  const folderOf = pathParts((state.sessions.get(state.scope)?.cwd || '').replace(/[\\/]+$/, ''));
  const rows = top.map(([filePath, file]) => {
    const counts = (file.writes ? boldCount(file.writes, TEXT.nouns.edit) : '') + (file.writes && file.reads ? ' · ' : '') + (file.reads ? boldCount(file.reads, TEXT.nouns.read) : '');
    return `<div class="vrow" data-seq="${file.seq}" ${tooltipAttribute(filePath + '\n' + TEXT.openLatest)}>
    <span class="a mono">${techBadgeIcon(techOfFile(filePath)) || iconSvg('files')}<span class="d">${escapeHtml(truncateToColumns(folderOf(filePath), 40))}</span>${escapeHtml(baseName(filePath))}</span><span class="b">${counts}</span></div>`;
  });
  return overviewCardHtml(TEXT.files, escapeHtml(TEXT.filesSub(byPath.size, top.length)), listHtml(rows));
}

// ---- shell commands by program (the part after any leading `cd … &&`)
const isSetupCommand = command => /^(cd|export|for)\s/.test(command);

function commandsListHtml(events) {
  const failedCalls = new Set(events.filter(event => event.event === 'PostToolUseFailure').map(event => event.data?.tool_use_id));
  const byProgram = new Map();
  for (const event of events) {
    if (event.event !== 'PreToolUse' || !SHELL_TOOLS.has(event.data?.tool_name)) continue;
    const commandLine = String(event.data.tool_input?.command || '').trim();
    if (!commandLine) continue;
    const command = splitShellCommands(commandLine).find(part => !isSetupCommand(part) && programOfCommand(part)) || commandLine;
    const program = baseName(programOfCommand(command) || command);
    const entry = byProgram.get(program) || { runs: 0, failures: 0, seq: event.seq, example: command };
    entry.runs++;
    entry.seq = event.seq;
    entry.example = command;
    if (failedCalls.has(event.data.tool_use_id)) entry.failures++;
    byProgram.set(program, entry);
  }
  const top = [...byProgram.entries()].sort((a, b) => b[1].runs - a[1].runs).slice(0, LIST_ROWS_MAX);
  if (!top.length) return overviewCardHtml(TEXT.commands, '', noneHtml(TEXT.noCommands));
  const rows = top.map(([program, entry]) => `<div class="vrow ${entry.failures === entry.runs ? 'fail' : ''}" data-seq="${entry.seq}" ${tooltipAttribute(TEXT.latestX(shorten(entry.example, 300)))}>
    <span class="a mono">${techBadgeIcon(techOfProgram(program)) || iconSvg('shell')}${escapeHtml(program)}</span><span class="b">${boldCount(entry.runs, TEXT.nouns.run)}${entry.failures ? ` · <span class="err">✕ ${entry.failures}</span>` : ''}</span></div>`);
  return overviewCardHtml(TEXT.commands, escapeHtml(`${countOf(byProgram.size, 'program')} · ${TEXT.topN(top.length)}`), listHtml(rows));
}

// ---- subagents: what type, what they were asked, how long they ran
function subagentsListHtml(events) {
  const subagents = new Map(), descriptionsWaiting = [];
  for (const event of events) {
    const data = event.data || {};
    if (event.event === 'PreToolUse' && isSubagentCall(data.tool_name)) descriptionsWaiting.push(data.tool_input?.description || '');
    if (event.event === 'SubagentStart') {
      subagents.set(data.agent_id ?? event.seq, { type: data.agent_type || TEXT.subagentLc, start: eventTime(event), end: null, seq: event.seq, description: descriptionsWaiting.shift() || '' });
    }
    if (event.event === 'SubagentStop' && subagents.has(data.agent_id)) subagents.get(data.agent_id).end = eventTime(event);
  }
  if (!subagents.size) return '';
  const now = Date.now();
  const rows = [...subagents.values()].slice(-LIST_ROWS_MAX).reverse().map(subagent => {
    const duration = subagent.end ? escapeHtml(formatDuration(subagent.end - subagent.start)) : `<span style="color:var(--ok)">● ${escapeHtml(formatDuration(now - subagent.start))}</span>`;
    const tooltip = `${subagent.type}${subagent.description ? ' — ' + subagent.description : ''}\n${TEXT.startedAt(formatTime(subagent.start))}`;
    return `<div class="vrow" data-seq="${subagent.seq}" ${tooltipAttribute(tooltip)}>
    <span class="a"><b>${escapeHtml(subagent.type)}</b> <span class="d">${escapeHtml(subagent.description)}</span></span><span class="b">${duration}</span></div>`;
  });
  return overviewCardHtml(TEXT.subagents, `${subagents.size}`, listHtml(rows));
}

// ---- the latest failures and denials
function problemsListHtml(events) {
  const problems = events.filter(isProblemEvent);
  if (!problems.length) return '';
  const rows = problems.slice(-6).reverse().map(event => {
    const [label, detail] = describeEvent(event);
    return `<div class="vrow fail" data-seq="${event.seq}" ${tooltipAttribute(label + ': ' + shorten(detail, TOOLTIP_PREVIEW_MAX))}>
    <span class="a"><b>${escapeHtml(label)}</b> ${escapeHtml(shorten(detail, 120))}</span><span class="b">${escapeHtml(formatTime(event.ts))}</span></div>`;
  });
  return overviewCardHtml(TEXT.problems, `${problems.length} · ${escapeHtml(TEXT.latestFirst)}`, listHtml(rows));
}
