'use strict';
// Session Observer dashboard — context alerts: a toast on the page for every new crossing and, while the window is not
// in focus and notifications are on (the Notify menu), a desktop notification too. Both open the turn behind it.

// opens the session, and in it the turn whose model step pushed the context over, at that step
async function openContextCrossing(sessionId, seq) {
  if (!state.sessions.has(sessionId)) return false;
  if (state.view === 'home' || state.view === 'overview') setView('route');
  if (state.scope !== sessionId) await selectScope(sessionId);
  const found = selectTurnOfSeq(seq);
  viewNeedsDrawing = true;
  return found;
}

function showContextNotification({ key, session, crossing }) {
  const { title, body } = contextAlertText(session, crossing);
  try {
    const notification = new Notification(title, { body, icon: ALERT_ICON, tag: 'so-ctx-' + session.id });
    notification.onclick = () => {
      window.focus();
      notification.close();
      dropContextToast(key);
      void openContextCrossing(session.id, crossing.seq);
    };
  } catch { /* the browser refused */ }
}

// called after the sessions change (with checkAlerts)
function checkContextAlerts() {
  const due = newContextCrossings([...state.sessions.values()]);
  if (!due.length) return;
  addContextToasts(due);
  if (alertMode === 'off' || !notificationsSupported() || Notification.permission !== 'granted' || document.hasFocus()) return;
  due.forEach(showContextNotification);
}

function initContextAlertControls() {
  elementById('ctxToasts').onclick = event => {
    const close = event.target.closest('[data-ctoast-close]');
    if (close) return dropContextToast(close.dataset.ctoastClose);
    const open = event.target.closest('[data-ctoast-open]');
    if (!open) return;
    const toast = contextToasts.find(item => item.key === open.dataset.ctoastOpen);
    if (!toast) return;
    dropContextToast(toast.key);
    void openContextCrossing(toast.session.id, toast.crossing.seq);
  };
}
