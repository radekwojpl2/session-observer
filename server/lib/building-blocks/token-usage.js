// Token counts from an API response's `usage`.
'use strict';

const ONE_MILLION_WINDOW = 1000000;

// everything the model was given for the request: uncached input, plus what was read from and written to the cache
const contextTokensOf = usage =>
  (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);

// a model id like "claude-opus-5-5[1m]" or "…-1m" has the 1M context window
const hasOneMillionWindow = modelId => /\[1m]|-1m/i.test(modelId || '');

module.exports = { ONE_MILLION_WINDOW, contextTokensOf, hasOneMillionWindow };
