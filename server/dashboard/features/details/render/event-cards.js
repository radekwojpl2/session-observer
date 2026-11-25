'use strict';
// Session Observer dashboard — Details cards: what an opened event row shows, per kind of event.
const NOTIFICATION_TYPES = TEXT.notificationTypes;
const STOP_REASONS = TEXT.stopReasons;
const sameToolCall = toolUseId => event => event.data?.tool_use_id === toolUseId;
const okMark = '<span style="color:var(--ok)">✓</span>';
const failedMark = () => `<span class="err">✕ ${escapeHtml(TEXT.failedLc)}</span>`;
const mutedHtml = text => `<span class="muted">${escapeHtml(text)}</span>`;

// ---- a tool call: both hook events behind its one row, PreToolUse (the call) and PostToolUse / PostToolUseFailure
// (the result)
function hookEventsHtml(call, result, failed) {
  const hookEvent = (event, missing) => (event
    ? `<details class="hev"><summary><b>${escapeHtml(event.event)}</b> · ${escapeHtml(formatTime(event.ts))} · #${event.seq}${event !== call && call ? ` · +${escapeHtml(formatDuration(eventTime(event) - eventTime(call)))}` : ''}</summary>${rawPayloadHtml(event)}</details>`
    : `<div class="hev muted">${missing}</div>`);
  return `<div class="hevs"><div class="k">${escapeHtml(TEXT.hookEvents)}</div>${hookEvent(call, 'PreToolUse · ' + escapeHtml(TEXT.notReceived))}${hookEvent(result, failed ? '' : 'PostToolUse · ' + escapeHtml(TEXT.notYet))}</div>`;
}

function toolCallCardHtml(event, turn) {
  const toolUseId = event.data?.tool_use_id;
  const call = event.event === 'PreToolUse' ? event : turn.events.find(other => other.event === 'PreToolUse' && sameToolCall(toolUseId)(other));
  const result = event.event !== 'PreToolUse' ? event : turn.events.find(other => other.event.startsWith('PostToolUse') && sameToolCall(toolUseId)(other));
  const data = (call || result).data, tool = data.tool_name, group = toolGroupOf(tool, data.tool_input);
  const failed = result?.event === 'PostToolUseFailure';
  const resultDuration = result && (result.data.duration_ms ?? result.duration_ms ?? (call ? eventTime(result) - eventTime(call) : null));
  const outcome = failed ? failedMark() : result ? `${okMark} ${escapeHtml(formatDuration(resultDuration))}` : escapeHtml(TEXT.runningEll);
  const askedBy = turn.events.find(other => other.event === 'ModelStep' && other.data?.tool_ids?.includes(toolUseId));
  const techs = techsOfToolCall(tool, data.tool_input).map(id => `${techBadgeIcon(id)} ${escapeHtml(TECH_BADGES[id].name)}`);
  const header = cardHeaderHtml(group, toolDisplayName(tool), ...techs, outcome, askedBy && mutedHtml(TEXT.askedByModel(formatTime(askedBy.ts))));
  const input = cardSectionHtml(escapeHtml(TEXT.input), toolInputHtml(tool, data.tool_input));
  const output = result ? cardSectionHtml(escapeHtml(failed ? TEXT.error : TEXT.output), toolOutputHtml(tool, result)) : '';
  return eventCardHtml(event, header + input + output, hookEventsHtml(call, result, failed));
}

// the Agent call that started a subagent: the latest one before it asking for that agent type
function agentCallForSubagent(event, turn) {
  return turn.events.filter(other => other.event === 'PreToolUse' && isSubagentCall(other.data?.tool_name) && eventTime(other) <= eventTime(event)
    && (!event.data?.agent_type || other.data.tool_input?.subagent_type === event.data.agent_type)).pop();
}

const backgroundWorkHtml = data =>
  cardSectionHtml(escapeHtml(TEXT.stillRunning), fieldTableHtml({ [TEXT.fields.tasks]: data.background_tasks, [TEXT.fields.crons]: data.session_crons }, NO_FIELDS_SKIPPED));

function stopCardHtml(event, turn) {
  const data = event.data || {}, start = turn.events[0], duration = start ? eventTime(event) - eventTime(start) : null;
  const header = cardHeaderHtml('you', event.event === 'Stop' ? TEXT.turnFinished : TEXT.turnFailed, duration != null && escapeHtml(formatDuration(duration)), data.stop_hook_active && escapeHtml(TEXT.stopHookActive));
  return eventCardHtml(event, header + cardSectionHtml(escapeHtml(TEXT.finalReply), cardTextHtml(data.last_assistant_message)) + backgroundWorkHtml(data)
    + fieldTableHtml(data, fieldsShownElsewhere('last_assistant_message', 'background_tasks', 'session_crons', 'stop_hook_active')));
}

function subagentStartCardHtml(event, turn) {
  const data = event.data || {}, call = agentCallForSubagent(event, turn);
  const header = cardHeaderHtml('agents', data.agent_type || TEXT.subagent, escapeHtml(TEXT.event.started), data.agent_id && mutedHtml(data.agent_id));
  return eventCardHtml(event, header + (call ? cardSectionHtml(escapeHtml(TEXT.taskGiven), toolInputHtml(call.data.tool_name, call.data.tool_input)) : ''));
}

function subagentStopCardHtml(event, turn) {
  const data = event.data || {};
  const start = turn.events.find(other => other.event === 'SubagentStart' && other.data?.agent_id === data.agent_id);
  const header = cardHeaderHtml('agents', data.agent_type || TEXT.subagent, escapeHtml(TEXT.event.finished), start && escapeHtml(formatDuration(eventTime(event) - eventTime(start))), data.agent_id && mutedHtml(data.agent_id));
  return eventCardHtml(event, header + cardSectionHtml(escapeHtml(TEXT.finalMessage), cardTextHtml(data.last_assistant_message)) + backgroundWorkHtml(data)
    + fieldTableHtml({ [TEXT.fields.transcript]: data.agent_transcript_path }, NO_FIELDS_SKIPPED));
}

function toolBatchCardHtml(event) {
  const calls = event.data?.tool_calls || [];
  const rows = calls.map(call => {
    const group = toolGroupOf(call.tool_name, call.tool_input);
    return `<div class="tu"><span class="n" style="color:var(--s-${group})">${toolIconHtml(call.tool_name, call.tool_input, group)}${escapeHtml(toolDisplayName(call.tool_name))}</span><span class="a">${escapeHtml(toolArgument(call))}</span><span></span></div>`;
  }).join('');
  return eventCardHtml(event, cardHeaderHtml('other', TEXT.toolBatch, escapeHtml(countOf(calls.length, 'call'))) + rows);
}

function modelSwitchCardHtml(event) {
  const data = event.data || {}, fields = TEXT.fields;
  const cost = data.estimated_cache_write_usd != null ? TEXT.resendCost(localizeDecimal(Number(data.estimated_cache_write_usd).toFixed(2))) : '';
  const cacheWarm = data.prompt_cache_warm == null ? null : data.prompt_cache_warm ? TEXT.yes : TEXT.no;
  const header = cardHeaderHtml('model', event.event === 'PreModelSwitch' ? TEXT.switchingModel : TEXT.modelSwitched, escapeHtml(`${data.from_model || '?'} → ${data.to_model || '?'}`), data.source && escapeHtml(data.source));
  return eventCardHtml(event, header
    + fieldTableHtml({ [fields.requested]: data.requested_model, [fields.contextTokens]: data.context_tokens != null ? formatCompactNumber(data.context_tokens) : null, [fields.cacheWarm]: cacheWarm, [fields.cost]: cost }, NO_FIELDS_SKIPPED)
    + fieldTableHtml(data, fieldsShownElsewhere('from_model', 'to_model', 'source', 'requested_model', 'context_tokens', 'prompt_cache_warm', 'estimated_cache_write_usd')));
}

function defaultCardHtml(event) {
  const [label, detail] = describeEvent(event);
  return eventCardHtml(event, cardHeaderHtml(toolGroupOfEvent(event) || 'other', label || event.event, detail && escapeHtml(shorten(detail, 160))) + fieldTableHtml(event.data || {}, COMMON_HOOK_FIELDS));
}

// card builders by event; each gets (event, turn, data, fields)
const EVENT_CARDS = {
  ModelStep: modelStepCardHtml,
  PreToolUse: toolCallCardHtml, PostToolUse: toolCallCardHtml, PostToolUseFailure: toolCallCardHtml,
  ModelText: (event, turn, data) => eventCardHtml(event,
    cardHeaderHtml('model', data.subagent ? TEXT.subagent : TEXT.mainAgent, escapeHtml(data.kind === 'thinking' ? TEXT.thinking : TEXT.wrote)) + cardTextHtml(data.text, data.kind === 'thinking' ? 'th' : '')),
  UserPromptSubmit: (event, turn, data) => eventCardHtml(event, cardHeaderHtml('you', TEXT.groups.you, escapeHtml(TEXT.sentPrompt)) + cardTextHtml(data.prompt, 'you')),
  UserPromptExpansion: (event, turn, data) => eventCardHtml(event, cardHeaderHtml('you', TEXT.promptExpanded)
    + cardSectionHtml(escapeHtml(TEXT.typed), cardTextHtml(data.prompt, 'you')) + cardSectionHtml(escapeHtml(TEXT.expandedTo), cardTextHtml(data.expanded_prompt))
    + fieldTableHtml(data, fieldsShownElsewhere('prompt', 'expanded_prompt'))),
  Stop: stopCardHtml, StopFailure: stopCardHtml,
  SubagentStart: subagentStartCardHtml,
  SubagentStop: subagentStopCardHtml,
  PermissionRequest: permissionCardHtml, PermissionDenied: permissionCardHtml,
  Notification: (event, turn, data) => eventCardHtml(event, cardHeaderHtml('you', TEXT.notification, escapeHtml(NOTIFICATION_TYPES[data.notification_type] || data.notification_type || ''))
    + cardTextHtml(data.message) + fieldTableHtml(data, fieldsShownElsewhere('message', 'notification_type'))),
  SessionStart: (event, turn, data) => eventCardHtml(event, cardHeaderHtml('context', TEXT.sessionStarted, escapeHtml(data.source || ''), data.model && mutedHtml(data.model))
    + fieldTableHtml(data, fieldsShownElsewhere('source', 'model'))),
  SessionEnd: (event, turn, data) => eventCardHtml(event, cardHeaderHtml('context', TEXT.sessionEnded, escapeHtml(data.reason || '')) + fieldTableHtml(data, fieldsShownElsewhere('reason'))),
  PostToolBatch: toolBatchCardHtml,
  MessageDisplay: (event, turn, data) => eventCardHtml(event, cardHeaderHtml('model', TEXT.messageShown, escapeHtml(data.final ? TEXT.final : TEXT.partX(data.index ?? ''))) + cardTextHtml(data.delta)),
  ConfigChange: (event, turn, data, fields) => eventCardHtml(event, cardHeaderHtml('context', TEXT.configChanged, escapeHtml(underscoresToSpaces(data.source)))
    + fieldTableHtml({ [fields.file]: data.file_path }, NO_FIELDS_SKIPPED) + fieldTableHtml(data, fieldsShownElsewhere('source', 'file_path'))),
  DirectoryAdded: (event, turn, data, fields) => eventCardHtml(event, cardHeaderHtml('files', TEXT.dirAdded, data.source && escapeHtml(TEXT.viaX(underscoresToSpaces(data.source))))
    + fieldTableHtml({ [fields.directory]: data.directory }, NO_FIELDS_SKIPPED) + fieldTableHtml(data, fieldsShownElsewhere('source', 'directory'))),
  WorktreeCreate: (event, turn, data) => eventCardHtml(event, cardHeaderHtml('files', TEXT.worktreeCreated, data.name && escapeHtml(data.name)) + fieldTableHtml(data, fieldsShownElsewhere('name'))),
  WorktreeRemove: (event, turn, data, fields) => eventCardHtml(event, cardHeaderHtml('files', TEXT.worktreeRemoved)
    + fieldTableHtml({ [fields.path]: data.worktree_path }, NO_FIELDS_SKIPPED) + fieldTableHtml(data, fieldsShownElsewhere('worktree_path'))),
  CwdChanged: (event, turn, data, fields) => eventCardHtml(event, cardHeaderHtml('context', TEXT.cwdChanged)
    + fieldTableHtml({ [fields.from]: data.old_cwd, [fields.to]: data.new_cwd }, NO_FIELDS_SKIPPED) + fieldTableHtml(data, fieldsShownElsewhere('old_cwd', 'new_cwd'))),
  PreModelSwitch: modelSwitchCardHtml, PostModelSwitch: modelSwitchCardHtml,
};

function permissionCardHtml(event) {
  const data = event.data || {};
  const header = cardHeaderHtml('you', event.event === 'PermissionRequest' ? TEXT.permissionAsked : TEXT.permissionDenied, escapeHtml(toolDisplayName(data.tool_name)), data.reason && escapeHtml(data.reason));
  return eventCardHtml(event, header + cardSectionHtml(escapeHtml(TEXT.forThisCall), toolInputHtml(data.tool_name, data.tool_input))
    + fieldTableHtml(data, fieldsShownElsewhere('tool_name', 'tool_input', 'reason')));
}

function eventCardFor(event, turn) {
  const build = Object.hasOwn(EVENT_CARDS, event.event) ? EVENT_CARDS[event.event] : null;
  return build ? build(event, turn, event.data || {}, TEXT.fields) : defaultCardHtml(event);
}

// ---- a model step
// The events that belong to one model step: by message id (tool_use ids for tools), or — for steps logged before
// those ids were recorded — the events of the same agent that follow it, up to its next step.
function modelStepParts(step, turn) {
  const data = step.data || {}, events = turn.events;
  const sameAgent = event => (event.data?.agent_id ?? null) === (data.agent_id ?? null);
  const following = [];
  for (let index = events.indexOf(step) + 1; index < events.length; index++) {
    const event = events[index];
    if (event.event === 'ModelStep' && sameAgent(event)) break;
    if (sameAgent(event)) following.push(event);
  }
  const hookEventsByToolUse = new Map();
  for (const event of events) {
    if ((event.event !== 'PreToolUse' && !event.event.startsWith('PostToolUse')) || !event.data?.tool_use_id) continue;
    const pair = hookEventsByToolUse.get(event.data.tool_use_id) || {};
    pair[event.event === 'PreToolUse' ? 'call' : 'result'] = event;
    hookEventsByToolUse.set(event.data.tool_use_id, pair);
  }
  const calls = data.tool_ids?.length
    ? data.tool_ids.map((id, index) => ({ name: data.tools[index], ...(hookEventsByToolUse.get(id) || {}) }))
    : following.filter(event => event.event === 'PreToolUse').map(event => ({ name: event.data.tool_name, matchedByOrder: true, ...(hookEventsByToolUse.get(event.data.tool_use_id) || { call: event }) }));
  const texts = data.msg_id ? events.filter(event => event.event === 'ModelText' && event.data?.msg_id === data.msg_id) : following.filter(event => event.event === 'ModelText');
  return { calls, texts };
}

function stepToolCallRowHtml(call) {
  const input = call.call?.data?.tool_input, group = toolGroupOf(call.name, input), latest = call.result || call.call;
  const failed = call.result?.event === 'PostToolUseFailure';
  const outcome = failed ? failedMark()
    : call.result ? `✓ ${escapeHtml(formatDuration(call.result.duration_ms ?? eventTime(call.result) - eventTime(call.call || call.result)))}`
    : call.call ? `<span class="busy">${escapeHtml(TEXT.runningEll)}</span>` : mutedHtml(TEXT.noHookEvent);
  const argument = toolArgument(latest?.data || {});
  return `<div class="tu"><span class="n" style="color:var(--s-${group})">${toolIconHtml(call.name, input, group)}${escapeHtml(toolDisplayName(call.name))}</span><span class="a" title="${escapeHtml(shorten(argument, TOOLTIP_PREVIEW_MAX))}">${escapeHtml(argument || '')}</span><span class="r">${outcome}</span></div>`;
}

function stepToolCallsHtml(calls, data) {
  if (!calls.length) return data.stop_reason === 'tool_use' ? `<div class="muted">${escapeHtml(TEXT.toolNotLogged)}</div>` : '';
  const byOrderNote = calls.some(call => call.matchedByOrder) ? ` <span style="text-transform:none;letter-spacing:0">${escapeHtml(TEXT.matchedByOrder)}</span>` : '';
  return `<div><div class="k">${escapeHtml(TEXT.toolsAsked)}${byOrderNote}</div>${calls.map(stepToolCallRowHtml).join('')}</div>`;
}

function stepTextsHtml(texts) {
  if (!texts.length) return '';
  const parts = texts.map(text => (text.data.kind === 'thinking' ? `<span class="th">${escapeHtml(TEXT.thinking)}: ${escapeHtml(text.data.text)}</span>` : escapeHtml(text.data.text)));
  return `<div><div class="k">${escapeHtml(TEXT.whatItWrote)}</div><div class="said">${parts.join('\n\n')}</div></div>`;
}

// the context the step was given, as a bar of cache read / cache write / uncached input
function stepTokensHtml(tokens, contextTokens, window) {
  const segments = [['cache_read', TEXT.cacheRead, 'var(--s-context)'], ['cache_write', TEXT.cacheWrite, 'var(--s-model)'], ['input', TEXT.uncached, 'var(--accent)']];
  const bar = segments.map(([field, , color]) => (tokens[field] ? `<i style="width:${(100 * tokens[field] / window).toFixed(2)}%;background:${color}"></i>` : '')).join('');
  const legend = segments.map(([field, label, color]) => `<span><i style="background:${color}"></i>${label} <b>${formatCompactNumber(tokens[field] || 0)}</b></span>`).join('');
  return `<div><div class="k">${escapeHtml(TEXT.groups.context)} · ${escapeHtml(formatCompactNumber(contextTokens))} ${escapeHtml(TEXT.tokensLc)}</div><div class="tokbar">${bar}</div>
    <div class="toklg">${legend}<span>${escapeHtml(TEXT.outputLc)} <b>${formatCompactNumber(tokens.output || 0)}</b></span></div></div>`;
}

function modelStepCardHtml(step, turn) {
  const data = step.data || {}, tokens = data.tokens || {}, contextTokens = tokens.context || 0;
  const session = state.sessions.get(step.session_id);
  const window = contextWindowFor(session?.agent, session?.context?.window, contextTokens, data.model);
  const { calls, texts } = modelStepParts(step, turn);
  const stopReason = STOP_REASONS[data.stop_reason] || (data.stop_reason ? data.stop_reason : TEXT.noStopReason);
  const header = `<div class="hd"><b>${escapeHtml(data.subagent ? TEXT.subagent : TEXT.mainAgent)}</b><span class="muted">${escapeHtml(data.model || '?')}</span><span>${escapeHtml(stopReason)}</span></div>`;
  return eventCardHtml(step, header + stepToolCallsHtml(calls, data) + stepTextsHtml(texts) + stepTokensHtml(tokens, contextTokens, window));
}
