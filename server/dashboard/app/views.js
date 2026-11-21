'use strict';
// Session Observer dashboard — the middle stage: switching between the views, and drawing the one shown.
//   home     — every agent as a tree (project → session → subagents), and what waits on you
//   overview — stat tiles, charts and lists (#mid, drawn by renderOverview)
//   route    — the current turn as a metro line: every model step and tool call is a stop
//   chat     — the conversation as a messenger: prompts, the agent's replies, tool calls as chips
//   context  — one session's whole conversation in full, read from its transcript
const VIEWS = ['home', 'overview', 'route', 'chat', 'context'].map(id => ({ id, label: TEXT.views[id] }));
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
  elementById('layouts').innerHTML = VIEWS.map(view =>
    `<button role="tab" aria-selected="${view.id === id}" data-layout="${view.id}" class="${view.id === id ? 'cur' : ''}">${view.label}</button>`).join('');
  viewNeedsDrawing = true;
  activityChanged = true;
  renderDetails(); // Details follows the Context view's order
  if (id === 'overview') scheduleRender('mid');
}

function viewHtml() {
  if (state.view === 'home') return homeViewHtml();
  if (state.view === 'chat') return chatViewHtml();
  if (state.view === 'context') return contextViewHtml();
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

// route: newest turn is on top, so jump to the focused turn when it changes, otherwise keep the scroll position
function rememberRouteScroll(box) {
  const scroller = box.querySelector('.mscroll');
  return { focusedTurn: scroller?.dataset.focus, top: scroller ? scroller.scrollTop : 0 };
}

function restoreRouteScroll(box, before) {
  const scroller = box.querySelector('.mscroll');
  if (scroller) scroller.scrollTop = scroller.dataset.focus !== before.focusedTurn ? Number(scroller.dataset.fy) : before.top;
}

// draws the view in #alt when something changed (at most every VIEW_REDRAW_MS otherwise)
function drawView(now) {
  if (!viewNeedsDrawing && now - lastViewDrawAt < VIEW_REDRAW_MS) return;
  viewNeedsDrawing = false;
  lastViewDrawAt = now;
  if (state.view === 'overview') return; // the overview is #mid, drawn by renderOverview
  const html = viewHtml();
  if (html === lastViewHtml) return;
  lastViewHtml = html;

  const box = viewBox();
  const routeScroll = rememberRouteScroll(box);
  rememberContextScroll(box);
  box.innerHTML = withAnimationPhase(html, now);
  restoreContextScroll(box);
  applyHoverHighlights();
  restoreChatScroll(box);
  restoreRouteScroll(box, routeScroll);
}
