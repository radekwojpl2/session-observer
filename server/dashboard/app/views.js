'use strict';
// Session Observer dashboard — the middle stage: switching between the views, and drawing the one shown.
//   home     — every agent as a tree (project → session → subagents), and what waits on you
//   overview — stat tiles, charts and lists (#mid, drawn by renderOverview)
//   route    — the current turn as a metro line: every model step and tool call is a stop
//   chat     — the conversation as a messenger: prompts, the agent's replies, tool calls as chips
//   context  — one session's whole conversation in full, read from its transcript
//   compare  — up to three sessions side by side: the same task run again, or by different agents
const VIEWS = ['home', 'overview', 'route', 'chat', 'context', 'compare'].map(id => ({ id, label: TEXT.views[id] }));
const VIEWS_WITHOUT_DETAILS = new Set(['home', 'compare']); // they use the Details panel's room themselves
const VIEW_REDRAW_MS = 250;
let lastViewDrawAt = 0;
let lastViewHtml = '';
let contextTurnShown = null; // the selected turn the Context view last scrolled to
function setView(id, historyMode = 'push') {
  if (!VIEWS.some(view => view.id === id)) id = 'home';
  if (historyMode !== 'none') {
    const address = new URL(location.href);
    if (address.searchParams.get('layout') !== id) {
      address.searchParams.set('layout', id);
      const relativeAddress = address.pathname + address.search + address.hash;
      history[historyMode + 'State'](null, '', relativeAddress);
    }
  }
  state.view = id;
  storage.set(SETTING_KEYS.layout, id);
  document.querySelector('.stage').dataset.layout = id;
  elementById('filters').dataset.layout = id;
  elementById('panels').dataset.layout = id;
  elementById('panels').toggleAttribute('data-no-details', VIEWS_WITHOUT_DETAILS.has(id));
  document.body.toggleAttribute('data-compare-wide', id === 'compare' && compareWide); // features/compare
  fitPanelsToWindow(); // the filters may have been hidden or shown
  // each tab's tooltip names its key (1 – 6, features/shortcuts)
  elementById('layouts').innerHTML = VIEWS.map((view, index) =>
    `<button role="tab" aria-selected="${view.id === id}" data-layout="${view.id}" class="${view.id === id ? 'cur' : ''}" title="${escapeHtml(view.label)} (${index + 1})" aria-keyshortcuts="${index + 1}">${view.label}</button>`).join('');
  viewNeedsDrawing = true;
  activityChanged = true;
  renderDetails(); // Details follows the Context view's order
  if (id === 'overview') scheduleRender('mid');
}

function viewHtml() {
  if (state.view === 'home') return homeViewHtml();
  if (state.view === 'chat') return chatViewHtml();
  if (state.view === 'context') return contextViewHtml();
  if (state.view === 'compare') return compareViewHtml();
  return routeViewHtml();
}

// ---- keeping each view's scroll position across re-renders
function rememberContextScroll(box) {
  const scroller = box.querySelector('.cxs');
  // newest is on top: hold the view still as items arrive above it
  if (scroller) contextScroll = { sessionId: contextView.sessionId, fromBottom: scroller.scrollHeight - scroller.scrollTop, atTop: scroller.scrollTop < 8 };
}

function restoreContextScroll(box) {
  const scroller = box.querySelector('.cxs');
  if (!scroller) return;
  if (contextScroll.sessionId === contextView.sessionId) {
    scroller.scrollTop = contextScroll.atTop ? 0 : scroller.scrollHeight - contextScroll.fromBottom;
  }
  // a turn picked outside the view (Prev / Next, keys, another view) scrolls to that turn's header
  const turnKey = state.selectedTurnKey;
  const pickedHere = Date.now() - lastContextClickAt <= 600;
  const header = turnKey && turnKey !== contextTurnShown && !pickedHere && scroller.querySelector(`.cxturn[data-tk="${CSS.escape(turnKey)}"]`);
  if (header?.classList.contains('shut')) setContextTurnCollapsed(header, false);
  if (header) scroller.scrollTop += header.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 4;
  contextTurnShown = turnKey;
}

const isScrolledToBottom = scroller => scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8;

// chat: jump to the selected turn when it changes; otherwise follow the bottom unless scrolled up
function restoreChatScroll(box) {
  const chat = box.querySelector('.chat');
  if (!chat) return;
  const previous = chatScroll;
  chatScroll = { turnKey: state.selectedTurnKey };
  const selected = state.selectedTurnKey && chat.querySelector(`.cturn[data-tk="${CSS.escape(state.selectedTurnKey)}"]`);
  if (selected && previous.turnKey !== state.selectedTurnKey) chat.scrollTop = selected.offsetTop - chat.offsetTop - 8;
  else chat.scrollTop = previous.atBottom !== false ? chat.scrollHeight : previous.top;
  const remember = () => { chatScroll.atBottom = isScrolledToBottom(chat); chatScroll.top = chat.scrollTop; };
  chat.onscroll = remember;
  remember();
}

// home and compare: the whole view scrolls, and live updates redraw it often, so keep where you scrolled to
const rememberHomeScroll = box => box.querySelector('.home, .cmp')?.scrollTop ?? 0;

function restoreHomeScroll(box, top) {
  const home = box.querySelector('.home, .cmp');
  if (home) home.scrollTop = top;
}

// route: a click inside it (a stop, a turn's header or its toggle) leaves what was clicked where it is under the mouse;
// a turn picked anywhere else (Prev / Next, keys, Details, Overview, Chat) is brought into view if it is out of sight;
// otherwise the scroll position stays
const ROUTE_ANCHOR_MS = 2000; // how long a click inside the route holds its place, for the redraw it causes
let routeClickAnchor = null;  // { selector, offset, at }: what was clicked, and how far below the top of the box

function anchorRouteClick(target) {
  const scroller = viewBox().querySelector('.mscroll');
  const item = scroller?.contains(target) ? target.closest('[data-tog], [data-key], [data-seqs]') : null;
  if (!item || !scroller.contains(item)) { routeClickAnchor = null; return; }
  const selector = item.dataset.tog ? `[data-tog="${CSS.escape(item.dataset.tog)}"]`
    : item.dataset.key ? `[data-key="${CSS.escape(item.dataset.key)}"]`
      : `[data-seqs~="${CSS.escape(item.dataset.seqs.trim().split(/\s+/)[0])}"]`;
  routeClickAnchor = { selector, offset: item.getBoundingClientRect().top - scroller.getBoundingClientRect().top, at: Date.now() };
}

function rememberRouteScroll(box) {
  const scroller = box.querySelector('.mscroll');
  return { focusedTurn: scroller?.dataset.focus, top: scroller ? scroller.scrollTop : 0 };
}

function restoreRouteScroll(box, before) {
  const scroller = box.querySelector('.mscroll');
  if (!scroller) return;
  scroller.scrollTop = before.top;
  const anchor = routeClickAnchor && Date.now() - routeClickAnchor.at <= ROUTE_ANCHOR_MS && scroller.querySelector(routeClickAnchor.selector);
  if (anchor) {
    scroller.scrollTop += anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top - routeClickAnchor.offset;
    return;
  }
  if (scroller.dataset.focus === before.focusedTurn) return;
  const turnTop = Number(scroller.dataset.fy);
  const inSight = turnTop >= before.top && turnTop <= before.top + scroller.clientHeight - 60;
  if (!inSight) scroller.scrollTop = turnTop;
}

// draws the view in #alt when something changed (at most every VIEW_REDRAW_MS otherwise)
function drawView(now) {
  if (!viewNeedsDrawing && now - lastViewDrawAt < VIEW_REDRAW_MS) return;
  if (pointerHeld) return; // a click in progress: drawn once it is released (rendering.js)
  viewNeedsDrawing = false;
  lastViewDrawAt = now;
  // a menu open in the view (Compare's session picker) would close under a redraw: drawn once it is left
  if (document.activeElement?.tagName === 'SELECT' && viewBox().contains(document.activeElement)) return;
  if (state.view === 'overview') return; // the overview is #mid, drawn by renderOverview
  const html = viewHtml();
  if (html === lastViewHtml) return;
  lastViewHtml = html;

  const box = viewBox();
  const routeScroll = rememberRouteScroll(box), homeScroll = rememberHomeScroll(box);
  const focusedPin = document.activeElement?.dataset.pinSession;
  const wasInPins = focusedPin && document.activeElement.closest('.hpins');
  rememberContextScroll(box);
  box.innerHTML = withAnimationPhase(html, now);
  restoreHomeScroll(box, homeScroll);
  if (focusedPin && state.view === 'home') {
    const selector = `[data-pin-session="${CSS.escape(focusedPin)}"]`;
    const pin = box.querySelector(`${wasInPins ? '.hpins' : '.hsessions'} ${selector}`) || box.querySelector(selector);
    pin?.focus({ preventScroll: true });
  }
  restoreContextScroll(box);
  applyHoverHighlights();
  restoreChatScroll(box);
  restoreRouteScroll(box, routeScroll);
}
