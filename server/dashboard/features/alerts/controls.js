'use strict';
// Session Observer dashboard — alerts: the Notify menu in the header, and the desktop notifications it turns on.
// A notification shows only while the dashboard window is not focused; a click on it opens the session.
const ALERT_BODY_MAX = 160;
// the app icon (docs/brand/icon-eye/icon-eye-256.png) as a PNG file: Windows toasts don't draw SVG or data: icons
const ALERT_ICON = 'dashboard/icon.png';
const notificationsSupported = () => typeof Notification === 'function';

function alertNotification(alert) {
  const name = homeSessionName(alert.session);
  if (alert.kind === 'done') return { title: TEXT.alerts.done(name), body: TEXT.alerts.doneBody };
  const body = alert.waits.map(wait => waitTitle(wait) + (wait.text ? ': ' + shorten(wait.text, ALERT_BODY_MAX) : '')).join('\n');
  return { title: TEXT.alerts.needsYou(name), body };
}

function showAlert(alert) {
  const { title, body } = alertNotification(alert);
  try {
    // one notification per session: a newer one replaces the older
    const notification = new Notification(title, { body, icon: ALERT_ICON, tag: 'so-' + alert.session.id, renotify: true, requireInteraction: alert.kind === 'needsYou' });
    notification.onclick = () => {
      window.focus();
      notification.close();
      if (!state.sessions.has(alert.session.id)) return;
      setView('route');
      void selectScope(alert.session.id);
    };
  } catch { /* the browser refused */ }
}

// called after the sessions change: alerts for what is new since the last call
function checkAlerts() {
  const due = newAlerts([...state.sessions.values()]);
  if (alertMode === 'off' || !due.length || !notificationsSupported() || Notification.permission !== 'granted') return;
  if (document.hasFocus()) return; // the page is in front of you: Home and the header already show it
  due.forEach(showAlert);
}

function renderAlertMenu() {
  const menu = elementById('notify');
  const blocked = notificationsSupported() && Notification.permission === 'denied';
  menu.innerHTML = ALERT_MODES.map(mode => `<option value="${mode}">${escapeHtml(TEXT.alerts.modes[mode])}</option>`).join('');
  menu.value = blocked ? 'off' : alertMode;
  menu.title = blocked ? TEXT.alerts.blocked : TEXT.alerts.title;
}

function initAlertControls() {
  const menu = elementById('notify');
  if (!notificationsSupported()) return menu.remove();
  renderAlertMenu();
  menu.onchange = async () => {
    alertMode = menu.value;
    // the browser asks once, on this click; a refusal leaves alerts off
    if (alertMode !== 'off' && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* ignore */ }
    }
    if (Notification.permission === 'denied') alertMode = 'off';
    storage.set(SETTING_KEYS.alerts, alertMode);
    renderAlertMenu();
  };
}
