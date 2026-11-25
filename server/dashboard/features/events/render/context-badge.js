'use strict';
// Session Observer dashboard — the context badge: a bar, the size and the change, as HTML or SVG. No "% of the
// window": the window is a guess (200k until the model's name or the tokens say 1M), so a percentage would jump.
// what the number is (the whole conversation the model read, not a running total), the cache split, and the change
const contextBadgeTooltip = size => TEXT.ctxEndTip(formatCompactNumber(size.tokens))
  + '\n' + TEXT.ctxWhatTip
  + (size.cached == null ? '' : '\n' + TEXT.ctxCacheTip(formatCompactNumber(size.cached), formatCompactNumber(Math.max(0, size.tokens - size.cached))))
  + (size.change == null ? '' : '\n' + TEXT.ctxChangeTip(size.changeText, size.change < 0));

// the numbers the hover card reads (context-tip.js): "tokens window cached change", '' when unknown
const contextBadgeData = size => `data-ctx="${[size.tokens, size.window, size.cached ?? '', size.change ?? ''].join(' ')}"`;

// the context badge as HTML (route header, Context view)
function contextBadgeHtml(size) {
  if (!size) return '';
  const change = size.changeText ? `<span class="cd ${size.tone}">${size.changeText}</span>` : '';
  return `<span class="ctxb" ${contextBadgeData(size)} aria-label="${escapeHtml(contextBadgeTooltip(size))}"><span class="cbar"><i style="width:${(size.fraction * 100).toFixed(1)}%"></i></span>`
    + `<b>${formatCompactNumber(size.tokens)}</b>${change}</span>`;
}

// the context badge in SVG, right-aligned at rightX on a turn divider (baseline y)
// the SVG badge, in px: a pill (its top above the text baseline) holding the bar, the value and the change
const BADGE = {
  charWidth: 7.2, padding: 10, height: 22, top: 15,
  barWidth: 46, barHeight: 6, barTop: 7, barGap: 8, // the bar, and the gap between it and the value
  valueRoom: 12, changeRoom: 16,                    // added to each text's width
};

function contextBadgeSvg(size, rightX, y) {
  if (!size) return '';
  const changeWidth = size.changeText ? size.changeText.length * BADGE.charWidth + BADGE.changeRoom : 0;
  const valueText = formatCompactNumber(size.tokens), valueWidth = valueText.length * BADGE.charWidth + BADGE.valueRoom;
  const width = BADGE.padding + BADGE.barWidth + BADGE.barGap + valueWidth + changeWidth, left = rightX - width;
  const barX = left + BADGE.padding, barY = y - BADGE.barTop, barRadius = BADGE.barHeight / 2;
  return `<g class="ctxs" ${contextBadgeData(size)} aria-label="${escapeHtml(contextBadgeTooltip(size))}"><rect class="cbg" x="${left}" y="${y - BADGE.top}" width="${width}" height="${BADGE.height}" rx="${BADGE.height / 2}"/>`
    + `<rect class="ctrk" x="${barX}" y="${barY}" width="${BADGE.barWidth}" height="${BADGE.barHeight}" rx="${barRadius}"/>`
    + `<rect class="cfil" x="${barX}" y="${barY}" width="${(BADGE.barWidth * size.fraction).toFixed(1)}" height="${BADGE.barHeight}" rx="${barRadius}"/>`
    + `<text class="cv" x="${barX + BADGE.barWidth + BADGE.barGap}" y="${y}">${escapeHtml(valueText)}</text>`
    + (size.changeText ? `<text class="cd ${size.tone}" x="${rightX - BADGE.padding}" y="${y}" text-anchor="end">${escapeHtml(size.changeText)}</text>` : '') + '</g>';
}
