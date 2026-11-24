'use strict';
// Session Observer dashboard — the context window: its size, and how full a number of tokens makes it.
const DEFAULT_CONTEXT_WINDOW = 200000;
const ONE_MILLION_WINDOW = 1000000;

// A reported window takes precedence over token-count estimates. Codex, pi and omp report their own, used as is.
// Claude Code reports its main agent's window through the optional status line filter, so use that value for steps
// whose model matches the report.
function contextWindowFor(session, tokens, model = session?.model) {
  const context = session?.context, observed = session?.observedContext;
  if (session?.agent && session.agent !== DEFAULT_AGENT && context?.window) return context.window;
  if (observed && observed.model === model) return observed.window;
  if (tokens > DEFAULT_CONTEXT_WINDOW || /\[1m]|-1m/i.test(model || '')) return ONE_MILLION_WINDOW;
  return (context && (!context.model || context.model === model) && context.window) || DEFAULT_CONTEXT_WINDOW;
}

// A context size for a badge: tokens, the change from before, the window and how full it is. The change's colour:
// shrank (compaction) = down, a big jump (≥ 10% of the window) = big, otherwise up.
function contextSize(tokens, change, window, changeText) {
  const tone = change == null ? '' : change < 0 ? 'down' : change >= window * 0.1 ? 'big' : 'up';
  return { tokens, change, window, fraction: Math.min(1, tokens / window), tone, changeText };
}
const signedTokens = change => `${change >= 0 ? '+' : '−'}${formatCompactNumber(Math.abs(change))}`;
