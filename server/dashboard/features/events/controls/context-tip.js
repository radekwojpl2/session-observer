'use strict';
// Session Observer dashboard — the context badge's hover card: what the number is, how full the window is, how much of
// it was read from the cache, and the change from before. One floating box for every badge (HTML and SVG); a badge
// carries its numbers in data-ctx (context-badge.js).
function contextTipBox() {
  return elementById('ctxtip') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'ctxtip', role: 'tooltip' }));
}

// data-ctx "tokens window cached change" (cached and change: '' when unknown) → a context size
function contextSizeFromBadge(badge) {
  const [tokens, window, cached, change] = badge.dataset.ctx.split(' ').map(value => (value === '' ? null : Number(value)));
  return contextSize(tokens, change, window, change == null ? '' : signedTokens(change), cached);
}

function contextTipHtml(size) {
  const row = (dotClass, label, value) => `<div class="ct-row"><span><i class="${dotClass}"></i>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
  const rows = [];
  if (size.cached != null) {
    rows.push(row('cached', TEXT.cacheRead, formatCompactNumber(size.cached)));
    rows.push(row('fresh', TEXT.ctxTipNew, formatCompactNumber(Math.max(0, size.tokens - size.cached))));
  }
  if (size.change != null) {
    const label = TEXT.ctxTipChange + (size.change < 0 ? ` (${TEXT.ctxTipCompacted})` : '');
    rows.push(`<div class="ct-row ct-change"><span>${escapeHtml(label)}</span><b class="cd ${size.tone}">${escapeHtml(size.changeText)}</b></div>`);
  }
  return `<div class="ct-h">${escapeHtml(TEXT.ctxTipTitle)}</div>
    <div class="ct-size"><b>${formatCompactNumber(size.tokens)}</b> <span>/ ${formatCompactNumber(size.window)} · ${percentOf(size)}%</span></div>
    <div class="ct-bar"><i style="width:${(size.fraction * 100).toFixed(1)}%"></i></div>
    <div class="ct-what">${escapeHtml(TEXT.ctxWhatTip)}</div>
    ${rows.length ? `<div class="ct-rows">${rows.join('')}</div>` : ''}`;
}

let hoveredContextBadge = null;

function showContextTip(badge) {
  if (badge === hoveredContextBadge) return;
  hoveredContextBadge = badge;
  const box = contextTipBox();
  if (!badge) {
    box.style.display = 'none';
    return;
  }
  box.innerHTML = contextTipHtml(contextSizeFromBadge(badge));
  box.style.display = 'block';
  // under the badge, right edges lined up; above it when there is no room below
  const badgeBox = badge.getBoundingClientRect(), tipBox = box.getBoundingClientRect();
  const below = badgeBox.bottom + 6, above = badgeBox.top - tipBox.height - 6;
  box.style.left = Math.max(8, Math.min(innerWidth - tipBox.width - 8, badgeBox.right - tipBox.width)) + 'px';
  box.style.top = (below + tipBox.height <= innerHeight - 8 || above < 8 ? below : above) + 'px';
}

function initContextTipControls() {
  document.addEventListener('mouseover', event => showContextTip(event.target.closest?.('[data-ctx]') || null));
  document.addEventListener('scroll', () => showContextTip(null), true);
}
