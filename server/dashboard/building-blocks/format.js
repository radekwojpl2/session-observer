'use strict';
// Session Observer dashboard — formatting: HTML escaping, shortening, numbers, times and durations in the chosen language.
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, char => HTML_ESCAPES[char]);

// one line of at most maxLength characters: whitespace collapsed, the rest cut with "…"
function shorten(text, maxLength = 160) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  return line.length > maxLength ? line.slice(0, maxLength) + '…' : line;
}

// preview lengths (characters) used in more than one place
const TITLE_PREVIEW_MAX = 140;   // a session title, or a prompt standing in for one
const TOOLTIP_PREVIEW_MAX = 400; // the longer text a hover tooltip shows

// text without HTML / XML-like tags (prompts often carry <system-reminder> and the like), on one line. A plugin
// mention, which Codex writes as "[@Session Observer](plugin://…)", goes; any other markdown link keeps its label.
const stripTags = text => String(text ?? '')
  .replace(/<\/?[a-z][\w-]*(?:\s[^>]*)?>/gi, ' ')
  .replace(/\[[^\]\n]*]\(plugin:\/\/[^)\s]*\)/g, ' ')
  .replace(/\[([^\]\n]*)]\([^)\s]*\)/g, '$1')
  .replace(/\s+/g, ' ').trim();
// the last part of a path ("src/app.ts" → "app.ts"), for both / and \ paths
const baseName = filePath => String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || filePath || '';
// hook enum values (user_settings, add_dir…) as words
const underscoresToSpaces = text => String(text || '').replace(/_/g, ' ');

// Cut to a number of columns. East Asian wide characters (CJK, kana, hangul, fullwidth forms) take two, as they do
// on screen.
// Written as escapes: the compatibility block starts at \uf900, which looks like (and normalizes to) \u8c48.
const WIDE_CHARACTER = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;
const columnsOf = char => (WIDE_CHARACTER.test(char) ? 2 : 1);
function truncateToColumns(text, maxColumns) {
  text = String(text ?? '');
  let width = 0;
  for (const char of text) width += columnsOf(char);
  if (width <= maxColumns) return text;
  let cut = '';
  width = 0;
  for (const char of text) {
    const columns = columnsOf(char);
    if (width + columns > maxColumns - 1) break;
    cut += char;
    width += columns;
  }
  return cut + '…';
}

// ---- numbers
// a decimal number in the language's own notation ("1.5" → "1,5")
const localizeDecimal = number => (TEXT.decimalSeparator === '.' ? String(number) : String(number).replace('.', TEXT.decimalSeparator));
// a count and its noun: countOf(3, 'tool') → "3 tools" (the language sets the order)
const countOf = (count, noun) => TEXT.count(count, TEXT.nouns[noun](count));
// 1234 → "1.2k", 2500000 → "2.50M"
function formatCompactNumber(number) {
  if (number >= 1e6) return localizeDecimal((number / 1e6).toFixed(2)) + 'M';
  if (number >= 1e3) return localizeDecimal((number / 1e3).toFixed(1)) + 'k';
  return String(number ?? 0);
}

// ---- times
const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const UNITS = TEXT.units;
const twoDigits = number => String(number).padStart(2, '0');

const formatTime = ts => new Date(ts).toLocaleTimeString(TIME_LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// how long something took: 450ms, 3.2s, 3m 05s, 2h 07m
function formatDuration(ms) {
  if (ms == null || isNaN(ms)) return '';
  if (ms < SECOND) return `${Math.round(ms)}${UNITS.ms}`;
  if (ms < MINUTE) return `${localizeDecimal((ms / SECOND).toFixed(1))}${UNITS.s}`;
  if (ms < HOUR) {
    const seconds = Math.round(ms / SECOND); // rounded first: 29m 59.6s is 30m 00s, not 29m 60s
    return `${Math.floor(seconds / 60)}${UNITS.m} ${twoDigits(seconds % 60)}${UNITS.s}`;
  }
  return `${Math.floor(ms / HOUR)}${UNITS.h} ${twoDigits(Math.floor(ms % HOUR / MINUTE))}${UNITS.m}`;
}

// a cost in US dollars, written the language's way: $0.42, $12.30, $123; under a cent, "<$0.01"
const USD_FORMATS = {};
function formatUsd(usd) {
  const digits = usd >= 100 ? 0 : 2;
  USD_FORMATS[digits] ??= new Intl.NumberFormat(TIME_LOCALE, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
  return usd > 0 && usd < 0.01 ? '<' + USD_FORMATS[digits].format(0.01) : USD_FORMATS[digits].format(usd);
}

// a session's cost (features/cost on the server): its estimate in USD, or null when no step of it has a price
const sessionCostOf = session => (session.cost?.priced ? session.cost.usd : null);
// some of its steps have no price, so the cost leaves them out
const isCostPartial = session => session.cost?.unpriced > 0;

// how long ago, in one unit: 12s, 5m, 3h, 2d
function formatAge(ms) {
  if (ms < MINUTE) return `${Math.max(0, Math.round(ms / SECOND))}${UNITS.s}`;
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}${UNITS.m}`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}${UNITS.h}`;
  return `${Math.floor(ms / DAY)}${UNITS.d}`;
}

// "5m ago", with hours and minutes under a day ("3h 12m ago")
function formatAgo(ts) {
  const ms = Date.now() - Date.parse(ts);
  if (ms < HOUR) return TEXT.ago(formatAge(ms));
  if (ms < DAY) return TEXT.ago(`${Math.floor(ms / HOUR)}${UNITS.h} ${Math.floor(ms % HOUR / MINUTE)}${UNITS.m}`);
  return TEXT.ago(formatAge(ms));
}
