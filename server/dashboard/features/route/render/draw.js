'use strict';
// Session Observer dashboard — Route view, the drawing: a session's turns as bands of stops in one SVG, newest on top.
const ROUTE_TURNS_MAX = 30;
// layout, in px
const ROUTE = {
  sidePadding: 56, top: 18, laneHeight: 52, bandBottom: 50, rowGap: 34,
  dividerHeight: 50, collapsedDividerHeight: 36,
  mainLabelSpace: 32, // main-line labels sit above their stops, out of the way of the forks leaving underneath
  edgeInset: 18,      // where a wrapped line leaves the right edge and comes back at the left
  endGap: 70,         // the end-of-turn stop's distance past the turn's last stop
  bottomPadding: 10,  // below the last band
  runningStub: 30,    // the dashed stub after a still-running subagent's last stop
};
// a turn divider: its line, the open / collapse toggle at the left, the label after it and the context badge at the right
const DIVIDER = {
  lineTop: 6, sideInset: 6, toggleTop: 6, toggleSize: 18, toggleRadius: 5, labelX: 32, labelBaseline: 20,
  // the prompt in the label gets the columns left after the badge and the "Turn n · time ·" prefix
  badgeSpace: 260, charWidth: 8, prefixColumns: 30, minPromptColumns: 20, promptColumnsWithoutBadge: 90,
};
const ROUTE_MIN_BOX = { width: 120, height: 160 }; // a smaller view box draws nothing

// which turns are open (key → open). Turns start collapsed; the focused and the newest turn get opened and stay open
// after that, until collapsed by hand
const routeTurnOpen = new Map();
let routeFocusedTurnKey = null; // the turn the route was last focused on

// ---- line keys for hover highlighting: every stop and link belongs to its turn's main line or to one subagent's branch
const lineKeyOfStop = stop => `${stop.turnKey}|${stop.onBranch ? stop.onBranch.firstStopIndex : MAIN_LANE}`.replace(/[\s"]/g, '_');
const lineKeyOfLink = link => lineKeyOfStop(link.kind === 'merge' ? link.from : link.to);
// a stop's keys: its own line, plus the branch it starts (Agent call) or brings back (⤴ stop)
function stopLineKeys(stops) {
  const extraKeys = new Map();
  const addKey = (index, key) => extraKeys.set(index, (extraKeys.get(index) || '') + ' ' + key);
  for (const stop of stops) {
    if (stop.forkFromIndex != null) addKey(stop.forkFromIndex, lineKeyOfStop(stop));
    if (stop.mergeFromIndex != null) addKey(stop.index, lineKeyOfStop(stops[stop.mergeFromIndex]));
  }
  return stop => lineKeyOfStop(stop) + (extraKeys.get(stop.index) || '');
}

// a polyline with rounded corners, as an SVG path
function roundedPolylinePath(points) {
  const number = value => value.toFixed(1), point = p => `${number(p.x)} ${number(p.y)}`;
  points = points.filter((p, index) => !index || p.x !== points[index - 1].x || p.y !== points[index - 1].y);
  const direction = (from, to) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return [(to.x - from.x) / length, (to.y - from.y) / length];
  };
  let path = `M${point(points[0])}`;
  for (let index = 1; index < points.length - 1; index++) {
    const [before, corner, after] = [points[index - 1], points[index], points[index + 1]];
    const radius = Math.min(12, Math.hypot(corner.x - before.x, corner.y - before.y) / 2, Math.hypot(after.x - corner.x, after.y - corner.y) / 2);
    const [inX, inY] = direction(before, corner), [outX, outY] = direction(corner, after);
    path += `L${number(corner.x - inX * radius)} ${number(corner.y - inY * radius)}Q${number(corner.x)} ${number(corner.y)} ${number(corner.x + outX * radius)} ${number(corner.y + outY * radius)}`;
  }
  return path + `L${point(points[points.length - 1])}`;
}

// ---- which turns are drawn
// the turn to show: the selected one, else the latest
const routeTurn = () => selectedTurn() || allTurns[allTurns.length - 1] || null;

// this session's turns, newest first (at most ROUTE_TURNS_MAX, always including the focused one)
function routeTurnChain(sessionTurns, focused) {
  let from = Math.max(0, sessionTurns.length - ROUTE_TURNS_MAX);
  const focusedIndex = sessionTurns.indexOf(focused);
  if (focusedIndex >= 0 && focusedIndex < from) from = focusedIndex;
  return sessionTurns.slice(from, from + ROUTE_TURNS_MAX).reverse();
}

function updateOpenTurns(chain, focused) {
  // the turn that just became focused opens even if it was collapsed by hand earlier
  if (routeFocusedTurnKey !== focused.key) {
    routeFocusedTurnKey = focused.key;
    routeTurnOpen.set(focused.key, true);
  }
  // a turn shown open stays open (a new turn starting, or picking another turn, never closes it) until collapsed by hand
  const newest = chain[0];
  for (const turn of chain) {
    if (!routeTurnOpen.has(turn.key) && (turn.key === focused.key || turn === newest)) routeTurnOpen.set(turn.key, true);
  }
}
const isRouteTurnOpen = turn => routeTurnOpen.get(turn.key) === true;

// The stops of every open turn, numbered across the whole drawing, plus the end-of-turn stops and the tails of
// subagents still running.
function collectRouteStops(chain, now) {
  const stops = [], models = new Map(), runningTailIndexes = [];
  const newest = chain[0];
  for (const turn of chain) {
    const model = buildRouteModel(turn), offset = stops.length;
    models.set(turn.key, model);
    if (!isRouteTurnOpen(turn)) continue;
    let furthest = 0;
    for (const stop of model.stops) {
      stop.index += offset;
      for (const link of ['previousIndex', 'forkFromIndex', 'mergeFromIndex']) if (stop[link] != null) stop[link] += offset;
      stop.turnKey = turn.key;
      stops.push(stop);
      furthest = Math.max(furthest, stop.position);
    }
    const isLive = !model.endEvent && turn === newest && isTurnRunning(turn);
    const mainLineRunning = model.stops.some(stop => stop.running && stop.lane === 0);
    if (model.endEvent || (isLive && !mainLineRunning)) stops.push(endOfTurnStop(turn, model, stops, offset, furthest, now));
    for (const branch of model.branches) if (!branch.closed && branch.running) runningTailIndexes.push(branch.lastStopIndex + offset);
  }
  return { stops, models, runningTailIndexes };
}

// the main line always runs to the end of the turn: past every subagent stop, not just its own last stop
function endOfTurnStop(turn, model, stops, offset, furthest, now) {
  const lastMainIndex = model.lastMainStopIndex != null ? model.lastMainStopIndex + offset : null;
  const endedAt = model.endEvent ? eventTime(model.endEvent) : now;
  const end = {
    lane: 0, isEnd: true, failed: model.endEvent?.event === 'StopFailure', isPending: !model.endEvent, seq: model.endEvent?.seq,
    previousIndex: lastMainIndex, turnKey: turn.key, durationMs: endedAt - Date.parse(turn.start),
  };
  end.position = Math.max(
    lastMainIndex != null ? stops[lastMainIndex].position + routeStopGap(stops[lastMainIndex], end) : 0,
    model.stops.length ? furthest + ROUTE.endGap : 0);
  end.index = stops.length;
  return end;
}

// ---- layout
// Each turn starts on a fresh band under a divider ("Turn N · time · prompt"). A turn too long for one band wraps
// like text: the whole band (main line and its subagent lanes) continues on the next one, each lane running off the
// right edge and picking up again at the left edge of the row underneath.
function layoutRows(chain, stops, usableWidth) {
  const rows = [], stopsByTurn = new Map();
  for (const stop of stops) {
    if (!stopsByTurn.has(stop.turnKey)) stopsByTurn.set(stop.turnKey, []);
    stopsByTurn.get(stop.turnKey).push(stop);
  }
  for (const turn of chain) {
    const firstRow = rows.length, open = isRouteTurnOpen(turn);
    rows.push({ maxLane: 0, dividerTurn: turn, collapsed: !open });
    if (!open) continue;
    for (const stop of stopsByTurn.get(turn.key) || []) {
      const wrap = Math.floor(stop.position / usableWidth);
      while (rows.length <= firstRow + wrap) rows.push({ maxLane: 0 });
      stop.row = firstRow + wrap;
      stop.x = ROUTE.sidePadding + stop.position - wrap * usableWidth;
    }
  }
  return rows;
}

// every link between two stops; a link's lane is where it runs horizontally
function routeLinks(stops) {
  const links = [];
  for (const stop of stops) {
    if (stop.forkFromIndex != null) links.push({ from: stops[stop.forkFromIndex], to: stop, kind: 'fork', lane: stop.lane });
    else if (stop.previousIndex != null) links.push({ from: stops[stop.previousIndex], to: stop, kind: 'line', lane: stop.lane });
    if (stop.mergeFromIndex != null) links.push({ from: stops[stop.mergeFromIndex], to: stop, kind: 'merge', lane: stops[stop.mergeFromIndex].lane });
  }
  return links;
}

// The main line runs along the top of each band (You first) and subagent lanes hang below it (lane 1 nearest), so
// every fork drops from its Agent call and every merge rises back into the main line from underneath.
// Sets each row's y and each stop's y; returns the drawing's height.
function placeRowsVertically(rows, stops, links) {
  for (const stop of stops) rows[stop.row].maxLane = Math.max(rows[stop.row].maxLane, stop.lane);
  for (const link of links) {
    for (let row = link.from.row; row <= link.to.row; row++) rows[row].maxLane = Math.max(rows[row].maxLane, link.lane);
  }
  let y = ROUTE.top, gapAfterLast = 0;
  for (const row of rows) {
    if (row.dividerTurn) {
      row.dividerY = y;
      y += row.collapsed ? ROUTE.collapsedDividerHeight : ROUTE.dividerHeight;
      gapAfterLast = 0;
    }
    if (row.collapsed) continue;
    row.mainY = y + ROUTE.mainLabelSpace;
    y = row.mainY + row.maxLane * ROUTE.laneHeight + ROUTE.bandBottom + ROUTE.rowGap;
    gapAfterLast = ROUTE.rowGap;
  }
  for (const stop of stops) stop.y = rows[stop.row].mainY + stop.lane * ROUTE.laneHeight;
  return y - gapAfterLast + ROUTE.bottomPadding;
}

// A fork drops from the Agent call then runs along its lane; a merge runs along the subagent's lane then rises into
// the main line. Across a wrap there is no connecting loop: each line runs off the right edge and continues from the
// left edge of the next row on the same lane.
function linkPaths({ from, to, kind, lane }, rows, rightEdge) {
  const leftEdge = ROUTE.edgeInset;
  const laneY = row => rows[row].mainY + lane * ROUTE.laneHeight;
  if (from.row === to.row) {
    if (kind === 'fork') return [roundedPolylinePath([from, { x: from.x, y: to.y }, to])];
    if (kind === 'merge') return [roundedPolylinePath([from, { x: to.x, y: from.y }, to])];
    return [roundedPolylinePath([from, to])];
  }
  const paths = [];
  paths.push(roundedPolylinePath(kind === 'fork'
    ? [from, { x: from.x, y: laneY(from.row) }, { x: rightEdge, y: laneY(from.row) }]
    : [from, { x: rightEdge, y: from.y }]));
  for (let row = from.row + 1; row < to.row; row++) paths.push(roundedPolylinePath([{ x: leftEdge, y: laneY(row) }, { x: rightEdge, y: laneY(row) }]));
  paths.push(roundedPolylinePath(kind === 'merge'
    ? [{ x: leftEdge, y: laneY(to.row) }, { x: to.x, y: laneY(to.row) }, to]
    : [{ x: leftEdge, y: to.y }, to]));
  return paths;
}

// ---- drawing
const endStopColor = stop => (stop.failed ? 'var(--err)' : stop.isPending ? 'var(--faint)' : 'var(--ok)');

function turnDividerSvg(row, drawing) {
  const { focused, pinned, sessionTurns, models, usableWidth, fullWidth } = drawing;
  const turn = row.dividerTurn, number = sessionTurns.indexOf(turn) + 1, isFocused = turn.key === focused.key, y = row.dividerY + DIVIDER.lineTop;
  const model = models.get(turn.key);
  const summary = row.collapsed && model
    ? ` · ${countOf(model.stepCount, 'step')} · ${countOf(model.toolCount, 'tool')}${model.problemCount ? ` · ✕${model.problemCount}` : ''}` : '';
  const context = turnContextInfo(sessionTurns, turn);
  const promptColumns = context
    ? Math.max(DIVIDER.minPromptColumns, Math.floor((usableWidth - DIVIDER.badgeSpace) / DIVIDER.charWidth) - DIVIDER.prefixColumns)
    : DIVIDER.promptColumnsWithoutBadge;
  const label = `${TEXT.turnN(number)} · ${formatTime(turn.start)} · ${truncateToColumns(stripTags(turn.prompt ?? TEXT.sessionStart), promptColumns)}${summary}`;
  const chevron = row.collapsed ? `M13 ${y + 11}l4 4l-4 4` : `M11 ${y + 13}l4 4l4 -4`;
  // the chevron toggles the turn open / collapsed; the rest of the divider selects the turn
  return `<g class="tdiv ${isFocused ? 'cur' : ''}${pinned && !isFocused ? ' dim' : ''}" data-key="${escapeHtml(turn.key)}"><line x1="${DIVIDER.sideInset}" y1="${y}" x2="${fullWidth - DIVIDER.sideInset}" y2="${y}"/>`
    + `<g class="ttog" data-tog="${escapeHtml(turn.key)}" data-open="${row.collapsed ? 0 : 1}"><rect x="${DIVIDER.sideInset}" y="${y + DIVIDER.toggleTop}" width="${DIVIDER.toggleSize}" height="${DIVIDER.toggleSize}" rx="${DIVIDER.toggleRadius}"/><path d="${chevron}"/><title>${escapeHtml(row.collapsed ? TEXT.expandTurn : TEXT.collapseTurn)}</title></g>`
    + `<text x="${DIVIDER.labelX}" y="${y + DIVIDER.labelBaseline}">${escapeHtml(label)}</text>${contextBadgeSvg(context, fullWidth - DIVIDER.sideInset, y + DIVIDER.labelBaseline)}<title>${escapeHtml(shorten(turn.prompt ?? TEXT.sessionStart, 300))}</title></g>`;
}

// Draw order: subagent lanes, then the forks / merges (over a background-coloured halo, so where one has to cross
// another lane it passes over it with a small gap), then the main line on top.
const linkDrawOrder = link => (link.lane === 0 ? 2 : link.kind === 'line' ? 0 : 1);

function linksSvg(links, rows, drawing) {
  let svg = '';
  for (const link of [...links].sort((a, b) => linkDrawOrder(a) - linkDrawOrder(b))) {
    const stop = link.to, dim = drawing.dimClass(stop), key = lineKeyOfLink(link);
    const color = stop.isEnd ? endStopColor(stop) : `var(--s-${stop.group})`;
    const classes = link.lane ? 'ml br' : `ml ${stop.running || stop.isPending ? 'flow' : ''}`;
    const style = link.lane ? '' : ` style="stroke:${color}"`;
    for (const path of linkPaths(link, rows, drawing.rightEdge)) {
      if (linkDrawOrder(link) === 1) svg += `<path class="halo${dim}" d="${path}"/>`;
      svg += `<path class="${classes}${dim}" data-ln="${key}" d="${path}"${style}/><path class="hit" data-ln="${key}" d="${path}"/>`;
    }
  }
  return svg;
}

// a subagent still running: a short dashed tail from its last stop
function runningTailsSvg(stops, tailIndexes, drawing) {
  let svg = '';
  for (const index of tailIndexes) {
    const stop = stops[index];
    if (stop) svg += `<path class="ml br flow${drawing.dimClass(stop)}" data-ln="${lineKeyOfStop(stop)}" d="M${stop.x.toFixed(1)} ${stop.y}l${Math.min(ROUTE.runningStub, drawing.rightEdge - stop.x)} 0"/>`;
  }
  return svg;
}

// a model step: a small diamond; its tooltip has what it wrote
function stepStopSvg(stop, drawing) {
  const written = stop.text ? '\n\n' + escapeHtml(shorten(stop.text, 600)) : '';
  return `<path class="md${stop.text ? ' said' : ''}${drawing.dimClass(stop)}" data-ln="${drawing.lineKeys(stop)}" data-seqs="${(stop.seqs || []).join(' ')}" d="M${stop.x.toFixed(1)} ${stop.y - 5}l5 5l-5 5l-5 -5z" style="fill:var(--s-${stop.group})" data-seq="${stop.seq}"><title>${stop.tooltip}${written}</title></path>`;
}

// the end of a turn: done, failed, or still working
function endStopSvg(stop, drawing) {
  const color = endStopColor(stop);
  const marker = stop.isPending ? '<circle r="8" class="ring"/>' : `<circle r="8" fill="${color}"/><circle r="13" fill="none" stroke="${color}" stroke-width="2"/>`;
  const tooltip = stop.isPending ? `<title>${escapeHtml(describeRouteActivity(drawing.models.get(stop.turnKey), drawing.now))}</title>` : '';
  const label = stop.isPending ? TEXT.workingEll : stop.failed ? TEXT.failedLc : TEXT.event.done;
  return `<g class="stop${drawing.dimClass(stop)}" data-ln="${drawing.lineKeys(stop)}" data-seqs="${stop.seq ?? ''}" transform="translate(${stop.x.toFixed(1)},${stop.y})"${stop.seq != null ? ` data-seq="${stop.seq}"` : ''} style="color:${color}">${marker}
        ${tooltip}<text class="sl" y="-33">${escapeHtml(label)}</text><text class="ss" y="-21">${escapeHtml(formatDuration(stop.durationMs))}</text></g>`;
}

// the text under a stop's label: how long it has been running, "failed", or its argument (a path as its file name)
function stopDetailText(stop, now) {
  const detail = String(stop.detail ?? '');
  if (stop.running) return `● ${formatDuration(now - stop.startedAt)}`;
  if (stop.failed) return TEXT.failedLc;
  return /[\\/]/.test(detail) && !/\s/.test(detail) ? baseName(detail) : detail;
}

// a call with a known language / tool: the stop is filled with the badge colour and carries its mark
function stopMarkSvg(stop, radius) {
  const tech = stop.tech ? TECH_BADGES[stop.tech] : null;
  if (!tech) return svgIconGroup(stop.group, -radius * 0.62, -radius * 0.62, (radius * 0.052).toFixed(3));
  const markSize = radius * 0.85;
  const mark = `<g transform="translate(${-Number(markSize.toFixed(2))},${-Number(markSize.toFixed(2))}) scale(${(markSize / 12).toFixed(3)})">${techBadgeMark(stop.tech)}</g>`;
  const more = stop.techs.length - 1;
  return mark + (more ? `<g class="tmore" transform="translate(${(radius * 0.8).toFixed(1)},${(-radius * 0.8).toFixed(1)})"><circle r="6.5"/><text y="3">+${more}</text></g>` : '');
}

// a tool call, prompt, subagent or context stop: a circle with its icon or badge, a label and a detail
function regularStopSvg(stop, drawing) {
  const radius = stop.lane && !stop.startsBranch ? 10 : 12;
  const tech = stop.tech ? TECH_BADGES[stop.tech] : null;
  const labelY = stop.lane ? radius + 16 : -radius - 20, detailY = stop.lane ? radius + 28 : -radius - 8;
  const techTitle = tech ? escapeHtml(techNames(stop.techs).join(' + ')) + ' · ' : '';
  // a call that started another agent's session carries that agent's badge colour on a ring, and names it
  const started = sessionsStartedByCall(stop.toolUseId);
  const startedMark = started.length ? `<circle class="started-ring agent-${agentKey(started[0].agent)}" r="${radius + 4}"/>` : '';
  const startedTitle = started.length ? ` · ${TEXT.startedSessions(started.length)}: ${started.map(child => `${agentName(child.agent)} ${shorten(sessionName(child), 40)}`).join(', ')}` : '';
  return `<g class="stop ${stop.failed ? 'fail' : ''} ${stop.mergeFromIndex != null ? 'mg' : ''}${drawing.dimClass(stop)}" data-ln="${drawing.lineKeys(stop)}" data-seqs="${(stop.seqs || []).join(' ')}" transform="translate(${stop.x.toFixed(1)},${stop.y})" style="color:var(--s-${stop.group})" data-seq="${stop.seq}">
      ${startedMark}<circle class="sn" r="${radius}"${tech ? ` style="fill:${tech.background}"` : ''}/>${stopMarkSvg(stop, radius)}${stop.running ? `<circle class="ring" r="${radius + 5}"/>` : ''}
      <text class="sl" y="${labelY}">${escapeHtml(truncateToColumns(stop.label, 12))}</text><text class="ss ${stop.failed ? 'err' : stop.running ? 'run' : ''}" y="${detailY}">${escapeHtml(truncateToColumns(stopDetailText(stop, drawing.now), 12))}</text>
      <title>${techTitle}${stop.tooltip}${stop.durationMs != null ? ' · ' + formatDuration(stop.durationMs) : ''}${escapeHtml(startedTitle)}</title></g>`;
}

function stopSvg(stop, drawing) {
  if (stop.isStep) return stepStopSvg(stop, drawing);
  if (stop.isEnd) return endStopSvg(stop, drawing);
  return regularStopSvg(stop, drawing);
}

function routeViewHtml() {
  const box = viewBox(), boxWidth = box.clientWidth, boxHeight = box.clientHeight, now = Date.now();
  if (boxWidth < ROUTE_MIN_BOX.width || boxHeight < ROUTE_MIN_BOX.height) return '';
  const pinned = selectedTurn();
  const focused = routeTurn();
  if (!focused) return `<div class="empty">${escapeHtml(TEXT.noTurnsRoute)}</div>`;

  const sessionTurns = allTurns.filter(turn => turn.sessionId === focused.sessionId);
  const chain = routeTurnChain(sessionTurns, focused);
  updateOpenTurns(chain, focused);
  const { stops, models, runningTailIndexes } = collectRouteStops(chain, now);

  const usableWidth = Math.max(160, boxWidth - 2 * ROUTE.sidePadding - 30);
  const fullWidth = usableWidth + 2 * ROUTE.sidePadding;
  const rows = layoutRows(chain, stops, usableWidth);
  const links = routeLinks(stops);
  const height = placeRowsVertically(rows, stops, links);
  const drawing = {
    focused, pinned, sessionTurns, models, now, usableWidth, fullWidth,
    rightEdge: fullWidth - ROUTE.edgeInset,
    lineKeys: stopLineKeys(stops),
    dimClass: stop => (pinned && stop.turnKey !== focused.key ? ' dim' : ''),
  };

  let svg = `<svg class="metro" width="${fullWidth}" height="${height}" viewBox="0 0 ${fullWidth} ${height}">`;
  for (const row of rows) if (row.dividerTurn) svg += turnDividerSvg(row, drawing);
  svg += linksSvg(links, rows, drawing);
  svg += runningTailsSvg(stops, runningTailIndexes, drawing);
  for (const stop of stops) svg += stopSvg(stop, drawing);
  svg += '</svg>';

  const focusedRow = rows.find(row => row.dividerTurn === focused);
  const focusedY = focusedRow ? Math.max(0, focusedRow.dividerY - 6) : 0;
  return routeFrameHtml({ focused, pinned, sessionTurns, models, boxHeight, svg, focusedY });
}
