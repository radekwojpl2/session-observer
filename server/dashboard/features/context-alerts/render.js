'use strict';
// Session Observer dashboard — context alerts: the toasts in the corner of the page, one per crossing, each with a
// button that opens the turn behind it. They stay until you close them (the oldest go past CONTEXT_TOASTS_MAX).
const CONTEXT_TOASTS_MAX = 4;
let contextToasts = []; // [{ key, session, crossing }], newest last

const crossingPercent = crossing => Math.round(crossing.threshold * 100);

// what a crossing says: "<session> · context past 75%", and its size and the step's jump
function contextAlertText(session, crossing) {
  const size = TEXT.ofPct(formatCompactNumber(crossing.tokens), formatCompactNumber(crossing.window), Math.round(crossing.pct * 100));
  return {
    title: TEXT.contextAlerts.title(homeSessionName(session), crossingPercent(crossing)),
    body: crossing.change > 0 ? TEXT.contextAlerts.bodyJump(size, signedTokens(crossing.change)) : TEXT.contextAlerts.body(size),
  };
}

function contextToastHtml(toast) {
  const { title, body } = contextAlertText(toast.session, toast.crossing);
  const level = toast.crossing.threshold >= 0.9 ? 'high' : toast.crossing.threshold >= 0.75 ? 'mid' : 'low';
  return `<div class="ctoast ${level}" role="status" data-ctoast="${escapeHtml(toast.key)}">
    <div class="ctoast-text"><b>${escapeHtml(title)}</b><span class="muted">${escapeHtml(body)}</span></div>
    <div class="ctoast-actions"><button data-ctoast-open="${escapeHtml(toast.key)}">${escapeHtml(TEXT.contextAlerts.open)}</button>`
    + `<button class="ctoast-close" data-ctoast-close="${escapeHtml(toast.key)}" title="${escapeHtml(TEXT.contextAlerts.close)}" aria-label="${escapeHtml(TEXT.contextAlerts.close)}">×</button></div>
  </div>`;
}

function renderContextToasts() {
  const box = elementById('ctxToasts');
  if (box) box.innerHTML = contextToasts.map(contextToastHtml).join('');
}

function addContextToasts(due) {
  contextToasts = contextToasts.concat(due).slice(-CONTEXT_TOASTS_MAX);
  renderContextToasts();
}

function dropContextToast(key) {
  contextToasts = contextToasts.filter(toast => toast.key !== key);
  renderContextToasts();
}
