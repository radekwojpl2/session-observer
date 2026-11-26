'use strict';
// Session Observer dashboard — the Details panel: the selected turn's prompt, reply and event list.

// what each model step wrote, by message id: written text wins over thinking
function textsByMessage(turn, stepsByMessage) {
  const written = new Map();
  for (const event of turn.events) {
    if (event.event !== 'ModelText' || !stepsByMessage.has(event.data?.msg_id)) continue;
    const messageId = event.data.msg_id, isThinking = event.data.kind === 'thinking';
    const text = (isThinking ? TEXT.thinking + ': ' : '') + event.data.text, earlier = written.get(messageId);
    if (!earlier) written.set(messageId, { text, isThinking });
    else if (earlier.isThinking && !isThinking) written.set(messageId, { text, isThinking: false });
    else if (earlier.isThinking === isThinking) written.set(messageId, { text: earlier.text + ' ' + text, isThinking });
  }
  return written;
}

// The rows of the event list. A finished tool call is one row, built from its result (PostToolUse) but placed where
// the call started, so the list keeps the order things began in (as the Route and the Chat do). One API response is a
// ModelStep plus a ModelText per text block: they are one row (the step's card lists the text).
function eventRowsOfTurn(turn) {
  const resultsByToolUse = new Map(turn.events.filter(event => isToolResult(event) && event.data?.tool_use_id).map(event => [event.data.tool_use_id, event]));
  const startedToolUses = new Set(turn.events.filter(event => event.event === 'PreToolUse' && event.data?.tool_use_id).map(event => event.data.tool_use_id));
  const stepsByMessage = new Map(turn.events.filter(event => event.event === 'ModelStep' && event.data?.msg_id).map(event => [event.data.msg_id, event]));
  const writtenByMessage = textsByMessage(turn, stepsByMessage);
  const running = isTurnRunning(turn), filtersOn = anyFilterActive(), besideContext = state.view === 'context';

  const isOwnRow = event => !(isToolResult(event) && startedToolUses.has(event.data?.tool_use_id))
    && !HIDDEN_IN_EVENT_LIST.has(event.event)
    && !(event.event === 'Stop' && turn.answer)
    && !(event.event === 'ModelText' && stepsByMessage.has(event.data?.msg_id));

  return turn.events.filter(isOwnRow).map(event => {
    const result = event.event === 'PreToolUse' ? resultsByToolUse.get(event.data?.tool_use_id) : null;
    const shown = result || event;
    const isRunning = running && event.event === 'PreToolUse' && !result;
    const open = state.openEventSeqs.has(shown.seq) || state.openEventSeqs.has(event.seq);
    const row = eventRowHtml(shown, isRunning, {
      duration: true, ts: event.ts,
      detail: event.event === 'PreToolUse' ? describeEvent(event)[1] : null, // a tool row says what was called; its result is in the card
      written: event.event === 'ModelStep' ? writtenByMessage.get(event.data?.msg_id)?.text : null,
    });
    // beside the Context view a row click shows its message there; the arrow only opens and closes the row
    const header = besideContext
      ? `<div class="erh"><button class="etog" title="${escapeHtml(open ? TEXT.collapse : TEXT.expand)}" aria-expanded="${open}">${open ? '▾' : '▸'}</button>${row}</div>` : row;
    const matches = filtersOn && (eventMatchesFilters(event) || eventMatchesFilters(shown));
    return `<div class="erow ${open ? 'open' : ''} ${matches ? 'hit' : ''}" id="ev-${shown.seq}" data-pre="${event.seq}">${header}${open ? eventCardFor(shown, turn) : ''}</div>`;
  });
}

function turnStateWord(turn) {
  if (isTurnRunning(turn)) return TEXT.running;
  if (turn.failed) return TEXT.failedLc;
  return turn.done ? TEXT.event.done : TEXT.unfinished;
}

function detailsHeaderHtml(turn) {
  const session = state.sessions.get(turn.sessionId);
  const duration = Date.parse(turn.end) - Date.parse(turn.start);
  const problems = turn.problemCount ? ` · <span class="err">${escapeHtml(countOf(turn.problemCount, 'problem'))}</span>` : '';
  return `<div class="dh"><h2>${escapeHtml(TEXT.turn)} · ${formatTime(turn.start)}</h2><span class="dbtns"><button id="prevTurn" title="${escapeHtml(TEXT.prevTitle)}">${escapeHtml(TEXT.prev)}</button> <button id="nextTurn" title="${escapeHtml(TEXT.nextTitle)}">${escapeHtml(TEXT.next)}</button> <button id="closeTurn" title="${escapeHtml(TEXT.closeTitle)}">${escapeHtml(TEXT.close)}</button> ${detailSizeButtonsHtml()}</span></div>
    <p class="lead">${escapeHtml(baseName(session?.cwd))} · ${escapeHtml(turnStateWord(turn))} · ${formatDuration(duration)} · ${escapeHtml(countOf(turn.stepCount, 'modelStep'))} · ${escapeHtml(countOf(turn.toolCount, 'toolCall'))} (${formatDuration(turn.toolMs)}) · ${escapeHtml(TEXT.outTokens(formatCompactNumber(turn.outputTokens)))}${problems}</p>`;
}

// the boxes opened inside event cards (raw payload, hook events), as "<row id>:<index>": live updates redraw the panel,
// and these stay open
const openCardBoxes = panel => [...panel.querySelectorAll('.erow')].flatMap(row =>
  [...row.querySelectorAll('details:not(.dsec)')].map((box, index) => (box.open ? `${row.id}:${index}` : null)).filter(Boolean));

function reopenCardBoxes(panel, keys) {
  for (const key of keys) {
    const split = key.lastIndexOf(':');
    const box = elementById(key.slice(0, split))?.querySelectorAll('details:not(.dsec)')[Number(key.slice(split + 1))];
    if (box) box.open = true;
  }
}

function renderDetails() {
  const panel = elementById('detail'), scrollTop = panel.scrollTop, openBoxes = openCardBoxes(panel);
  const turn = selectedTurn();
  if (!turn) {
    panel.innerHTML = `<div class="dh"><h2>${escapeHtml(TEXT.details)}</h2>${detailSizeButtonsHtml()}</div><p class="muted">${TEXT.pickTurn}</p>${colourKeyHtml(turn)}`;
    return;
  }
  const rows = eventRowsOfTurn(turn);
  // beside the Context view, the events follow its order (newest first unless switched); elsewhere they read top down
  const besideContext = state.view === 'context', newestFirst = besideContext && contextOrder !== 'old';
  if (newestFirst) rows.reverse();
  const prompt = turn.prompt !== null ? escapeHtml(turn.prompt) : `<span class="muted">${escapeHtml(TEXT.noPrompt)}</span>`;
  const eventsTitle = `${escapeHtml(TEXT.events)} <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">· ${newestFirst ? escapeHtml(TEXT.newestFirst) + ' · ' : ''}${escapeHtml(besideContext ? TEXT.eventsCtxHint : TEXT.eventsHint)}</span>`;
  panel.innerHTML = `${detailsHeaderHtml(turn)}
    ${detailSectionHtml('prompt', escapeHtml(TEXT.prompt), `<div class="q">${prompt}</div>`)}
    ${turn.answer ? detailSectionHtml('reply', escapeHtml(TEXT.reply), `<div class="q ans">${escapeHtml(turn.answer)}</div>`) : ''}
    ${detailSectionHtml('events', eventsTitle, `<div>${rows.join('')}</div>`)}${colourKeyHtml(turn)}`;
  reopenCardBoxes(panel, openBoxes);
  panel.scrollTop = scrollTop;
  applyHoverHighlights(); // keep the row lit for the chat item / route stop under the mouse
}

function selectTurn(key, seq) {
  state.selectedTurnKey = key;
  state.openEventSeqs = new Set(seq ? [seq] : []);
  renderDetails();
  renderOverview();
  const panel = elementById('detail');
  const row = seq && detailRowForSeq(seq);
  // scroll only the panel (scrollIntoView would also scroll the page)
  panel.scrollTop = row ? panel.scrollTop + row.getBoundingClientRect().top - panel.getBoundingClientRect().top - panel.clientHeight / 3 : 0;
}

function closeSelectedTurn() {
  state.selectedTurnKey = null;
  renderDetails();
  renderOverview();
}

// the previous (-1) or next (+1) turn among those matching the filters
function selectAdjacentTurn(direction) {
  const turns = allTurns.filter(turnMatchesFilters);
  if (!turns.length) return;
  const index = turns.findIndex(turn => turn.key === state.selectedTurnKey);
  const next = index < 0 ? (direction > 0 ? 0 : turns.length - 1) : Math.max(0, Math.min(turns.length - 1, index + direction));
  selectTurn(turns[next].key);
}

// the turn a clicked event row / chip / stop belongs to, opened at that event
function selectTurnOfSeq(seq) {
  const turn = turnBySeq.get(seq);
  if (turn) selectTurn(turn.key, seq);
  return !!turn;
}
