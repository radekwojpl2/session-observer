'use strict';
// Session Observer dashboard — Context view, usage: Claude Code's /context, rebuilt from the transcript. A grid of 200
// cells (each 0.5% of the window) and a legend of what fills it; each legend row opens its card below, where the
// content and the breakdown are. The total is measured (the latest model step); the parts are estimates from the text
// sizes, and Messages is what's left of the total.
const USAGE_CELLS = 200;
const AUTOCOMPACT_BUFFER_TOKENS = 33000; // what Claude Code holds back for auto-compaction
// the card each usage category opens ('@msgs': the first turn of the conversation)
const USAGE_CATEGORY_CARD = { sys: 'sys', tools: 'tools', mcpt: 'tools', mcpi: 'mcp', mem: 'ins', skills: 'skills', agents: 'agents', defer: 'deferred', msgs: '@msgs' };

// 12345 → "12.3k", 1000000 → "1m"
function formatTokenCount(count) {
  if (count >= 1e6) return localizeDecimal(+(count / 1e6).toFixed(1)) + 'm';
  if (count >= 1e3) return localizeDecimal(+(count / 1e3).toFixed(1)) + 'k';
  return String(Math.round(count));
}
const formatPercentOfWindow = (count, window) => localizeDecimal((count / window * 100).toFixed(1)) + '%';

// [category, label, tokens] for every category with something in it; Messages last, as the rest of the total
function usageCategories(data, usedTokens) {
  const tokensOf = chars => Math.round(chars / charsPerToken());
  const isMcpTool = tool => /^mcp__/.test(tool.name);
  const hasSystemPrompt = data.system != null, labels = TEXT.usageCategories;
  const categories = [
    hasSystemPrompt && ['sys', labels.sys, tokensOf(data.system.length)],
    hasSystemPrompt && ['tools', labels.tools, tokensOf(sumLengths(data.tools.filter(tool => !isMcpTool(tool)), toolDefinitionLength))],
    hasSystemPrompt && ['mcpt', labels.mcpt, tokensOf(sumLengths(data.tools.filter(isMcpTool), toolDefinitionLength))],
    ['mcpi', labels.mcpi, tokensOf(sumLengths(data.mcp || [], server => textLength(server.description)))],
    ['mem', labels.mem, tokensOf(sumLengths(data.instructions || [], file => textLength(file.content)))],
    ['skills', labels.skills, tokensOf(listingLength(data.skills))],
    ['agents', labels.agents, tokensOf(listingLength(data.agents))],
    ['defer', labels.defer, tokensOf(deferredNamesLength(data.deferred))],
  ].filter(category => category && category[2] > 0);
  const rest = Math.max(0, usedTokens - categories.reduce((sum, category) => sum + category[2], 0));
  categories.push(['msgs', hasSystemPrompt ? labels.msgs : labels.msgsAll, rest]);
  return categories;
}

const usageCell = kind => `<i class="c ${kind}"></i>`;

// each category gets its share of the cells, at least one; a category's last cell is half-filled when the share isn't
// whole; then free space, then the autocompact buffer
function usageGridCells(categories, window, bufferTokens) {
  const cells = [];
  for (const [category, , tokens] of categories) {
    const share = tokens / window * USAGE_CELLS, fullCells = Math.floor(share), hasHalfCell = share - fullCells > 0.05 || !fullCells;
    for (let index = 0; index < fullCells; index++) cells.push(usageCell(`full cu-${category}`));
    if (hasHalfCell) cells.push(usageCell(`half cu-${category}`));
  }
  const bufferCells = Math.round(bufferTokens / window * USAGE_CELLS), freeCells = Math.max(0, USAGE_CELLS - cells.length - bufferCells);
  for (let index = 0; index < freeCells; index++) cells.push(usageCell('free cu-free'));
  for (let index = 0; index < bufferCells && cells.length < USAGE_CELLS; index++) cells.push(usageCell('buf cu-buf'));
  return cells;
}

function usageLegendHtml(categories, window, freeTokens, bufferTokens) {
  const tokensWord = escapeHtml(TEXT.tokens);
  const share = count => `<span class="muted">(${formatPercentOfWindow(count, window)})</span>`;
  return categories.map(([category, label, tokens]) =>
    `<div class="cu-go" data-cxgo="${USAGE_CATEGORY_CARD[category]}" title="${escapeHtml(TEXT.showBelow)}">${usageCell(`full cu-${category}`)} ${escapeHtml(label)}: <b>${formatTokenCount(tokens)}</b> ${tokensWord} ${share(tokens)}</div>`).join('')
    + `<div>${usageCell('free cu-free')} ${escapeHtml(TEXT.freeSpace)}: <b>${formatTokenCount(freeTokens)}</b> ${share(freeTokens)}</div>`
    + (bufferTokens ? `<div>${usageCell('buf cu-buf')} ${escapeHtml(TEXT.autocompact)}: <b>${formatTokenCount(bufferTokens)}</b> ${tokensWord} ${share(bufferTokens)}</div>` : '');
}

function contextUsageHtml(data, idPrefix) {
  const lastStep = data.items.filter(item => item.kind === 'step').at(-1);
  if (!lastStep) return '';
  const window = contextSizeInfo(lastStep.ctx, null).window, usedTokens = lastStep.ctx;
  const categories = usageCategories(data, usedTokens);
  // Claude Code's buffer; Codex reports a window it already keeps its own headroom out of
  const buffer = agentKeepsAutocompactBuffer(data.agent) ? AUTOCOMPACT_BUFFER_TOKENS : 0;
  const bufferTokens = Math.min(buffer, Math.max(0, window - usedTokens));
  const freeTokens = Math.max(0, window - usedTokens - bufferTokens);
  const tokensWord = escapeHtml(TEXT.tokens), usedPercent = Math.round(usedTokens / window * 100);

  const summary = `<div class="cu-top"><div class="cu-grid" title="${escapeHtml(TEXT.cellsTitle)}">${usageGridCells(categories, window, bufferTokens).join('')}</div><div class="cu-side">
    <div><b>${escapeHtml(data.model || TEXT.modelUnknown)}</b></div>
    <div><b>${formatTokenCount(usedTokens)}</b>/${formatTokenCount(window)} ${tokensWord} <span class="muted">(${usedPercent}%)</span>${lastStep.ts ? ` <span class="muted">· ${formatTime(lastStep.ts)}</span>` : ''}</div>
    <div class="cu-h">${escapeHtml(TEXT.usageByCat)}</div>${usageLegendHtml(categories, window, freeTokens, bufferTokens)}</div></div>`;
  const note = contextNoteHtml(TEXT.cuNote(data.measured?.cpt ? localizeDecimal(data.measured.cpt.toFixed(1)) : null, data.system != null));
  const header = `${iconSvg('context')} <b>${escapeHtml(TEXT.ctxUsage)}</b> <span class="muted">${escapeHtml(data.model || '')}</span><span class="grow"></span><span class="sz">${formatTokenCount(usedTokens)}/${formatTokenCount(window)} ${tokensWord} (${usedPercent}%)</span>`;
  return contextCardHtml(idPrefix + 'usage', 'sys usage', header, summary + note, true);
}
