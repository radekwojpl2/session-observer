'use strict';
// Session Observer dashboard — Sessions panel, the controls: a click picks the scope, hovering shows the hover card.
const pendingSessionPins = new Set();

async function toggleSessionPin(button) {
  const id = button.dataset.pinSession;
  if (pendingSessionPins.has(id)) return;
  pendingSessionPins.add(id);
  button.setAttribute('aria-disabled', 'true');
  const method = button.getAttribute('aria-pressed') === 'true' ? 'DELETE' : 'PUT';
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/pin`, { method });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    if (!state.connected || state.frozen) {
      await loadSessions();
      scheduleRender('sessions', 'mid');
    }
  } catch (error) {
    alert(TEXT.home.pinFailed(error.message));
  } finally {
    pendingSessionPins.delete(id);
    button.removeAttribute('aria-disabled');
  }
}

async function deleteSessionFromDashboard(button) {
  const id = button.dataset.deleteSession;
  const session = state.sessions.get(id);
  if (!confirm(TEXT.deleteSessionConfirm(session ? sessionName(session) : id))) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})); // an error page need not be JSON
      throw new Error(body.error || `HTTP ${response.status}`);
    }
  } catch (error) {
    button.disabled = false;
    alert(TEXT.deleteSessionFailed(error.message)); // the session stays: say so, or the click looks ignored
  }
}

async function loadOlderSessions(button) {
  button.disabled = true;
  try {
    const response = await fetch('/api/history/older', { method: 'POST' });
    if (response.ok) state.history = await response.json(); // the server also sends history, which reloads the page's data
  } catch { /* server down */ }
  button.disabled = false;
}

// ---- switching sessions from the keyboard (features/shortcuts): the list's order, All activity first

// the sessions panel scrolls just enough to show the selected card
function revealSelectedSession() {
  renderSessions();
  const panel = elementById('sessions');
  const card = panel.querySelector('.card.sel');
  if (!card) return;
  const cardBox = card.getBoundingClientRect(), panelBox = panel.getBoundingClientRect();
  if (cardBox.top < panelBox.top) panel.scrollTop -= panelBox.top - cardBox.top;
  else if (cardBox.bottom > panelBox.bottom) panel.scrollTop += cardBox.bottom - panelBox.bottom;
}

function selectSessionFromKeyboard(id) {
  if (id === state.scope) return;
  selectScope(id);
  revealSelectedSession();
}

// the next (+1) or previous (-1) entry of the sessions panel
function selectAdjacentSession(direction) {
  const ids = [ALL_SESSIONS, ...visibleSessions().map(session => session.id)];
  const index = ids.indexOf(state.scope);
  const next = index < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, index + direction));
  selectSessionFromKeyboard(ids[next]);
}

// the next session waiting on you, longest-waiting first, round and round
function selectNextSessionNeedingYou() {
  const ids = sessionsNeedingYou([...state.sessions.values()]).map(session => session.id);
  if (!ids.length) return;
  selectSessionFromKeyboard(ids[(ids.indexOf(state.scope) + 1) % ids.length]);
}

function initSessionsControls() {
  elementById('sessions').onclick = event => {
    const pinButton = event.target.closest('[data-pin-session]');
    if (pinButton) return toggleSessionPin(pinButton);
    const deleteButton = event.target.closest('[data-delete-session]');
    if (deleteButton) {
      event.preventDefault();
      event.stopPropagation();
      return deleteSessionFromDashboard(deleteButton);
    }
    const olderButton = event.target.closest('[data-load-older]');
    if (olderButton) return loadOlderSessions(olderButton);
    const card = event.target.closest('.card');
    if (card) selectScope(card.dataset.id);
  };
  elementById('sessions').addEventListener('mouseover', event => hoverSession(event.target.closest('.sess-list .card')?.dataset.id ?? null));
  elementById('sessions').addEventListener('mouseleave', () => hoverSession(null));
  elementById('sessions').addEventListener('scroll', () => { if (hoveredSessionId) hoverSession(null); });
  // a link to a session started by, or starting, another (links.js) opens that session on its Route, wherever it is
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-open-session]');
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    setView('route');
    selectScope(link.dataset.openSession);
  }, true);
}
