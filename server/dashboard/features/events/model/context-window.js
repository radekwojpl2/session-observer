'use strict';
// Session Observer dashboard — the context window: its size, and how full a number of tokens makes it.
const DEFAULT_CONTEXT_WINDOW = 200000;
const ONE_MILLION_WINDOW = 1000000;

// the window a session's context fills. Codex reports its own (272k by default), which is used as is. Claude Code's
// is 200k, unless the tokens are past that or the model's name says 1M.
function contextWindowFor(agent, ownWindow, tokens, model = '') {
  if (agent === CODEX && ownWindow) return ownWindow;
  if (tokens > DEFAULT_CONTEXT_WINDOW || /\[1m\]|-1m/i.test(model || '')) return ONE_MILLION_WINDOW;
  return ownWindow || DEFAULT_CONTEXT_WINDOW;
}

// A context size for a badge: tokens, the change from before, the window and how full it is, and the tokens of it read
// from the prompt cache (null when unknown). The change's colour: shrank (compaction) = down, a big jump (≥ 10% of the
// window) = big, otherwise up.
function contextSize(tokens, change, window, changeText, cached = null) {
  const tone = change == null ? '' : change < 0 ? 'down' : change >= window * 0.1 ? 'big' : 'up';
  return { tokens, change, window, fraction: Math.min(1, tokens / window), tone, changeText, cached };
}
const signedTokens = change => `${change >= 0 ? '+' : '−'}${formatCompactNumber(Math.abs(change))}`;
