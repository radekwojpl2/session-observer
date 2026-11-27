// What models cost through their makers' APIs, in USD per million tokens, to estimate what a session would cost at
// API prices (a subscription pays differently). Taken from the providers' pricing pages on 2026-11-27:
//   Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
//   OpenAI:    https://developers.openai.com/api/docs/pricing
// Prices change, and agents run models this table doesn't know: <data dir>/prices.json adds or replaces models, in
// the same shape (README: Config).
// A price: { input, output, cache_read, cache_write (the 5-minute cache), cache_write_1h, long? }. `long` is what the
// model costs when a request's prompt (its input, cache reads and cache writes) is over `long.above` tokens.
'use strict';
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../../building-blocks/config');

const PRICES_FILE = path.join(DATA_DIR, 'prices.json');

// Anthropic: a cache write costs 1.25× the input price for 5 minutes and 2× for an hour; reads differ by model
const anthropic = (input, output, cacheRead) => ({ input, output, cache_read: cacheRead, cache_write: input * 1.25, cache_write_1h: input * 2 });
// OpenAI: cached input is cheaper, writing the cache costs nothing extra; prompts over 272K tokens cost more
const OPENAI_LONG_ABOVE = 272000;
const openai = (input, cachedInput, output, long) => ({
  input, output, cache_read: cachedInput, cache_write: 0, cache_write_1h: 0,
  ...(long && { long: { above: OPENAI_LONG_ABOVE, ...openai(...long) } }),
});
const NO_CACHE_DISCOUNT = input => input; // models whose page lists no cached-input price

const BUILT_IN_PRICES = {
  // Anthropic: Fable and Mythos, Opus, Sonnet, Haiku
  'claude-fable-5-2': anthropic(8, 40, 0.20), 'claude-mythos-5-2': anthropic(8, 40, 0.20),
  'claude-fable-5-1': anthropic(10, 50, 0.25), 'claude-mythos-5-1': anthropic(10, 50, 0.25),
  'claude-fable-5': anthropic(10, 50, 1), 'claude-mythos-5': anthropic(10, 50, 1),
  'claude-opus-5-5': anthropic(4, 20, 0.20),
  'claude-opus-5': anthropic(5, 25, 0.50), 'claude-opus-4-8': anthropic(5, 25, 0.50), 'claude-opus-4-7': anthropic(5, 25, 0.50),
  'claude-opus-4-6': anthropic(5, 25, 0.50), 'claude-opus-4-5': anthropic(5, 25, 0.50),
  'claude-opus-4-1': anthropic(15, 75, 1.50), 'claude-opus-4': anthropic(15, 75, 1.50),
  'claude-sonnet-5-5': anthropic(2, 10, 0.10), 'claude-sonnet-5': anthropic(2, 10, 0.20),
  'claude-sonnet-4-6': anthropic(3, 15, 0.30), 'claude-sonnet-4-5': anthropic(3, 15, 0.30), 'claude-sonnet-4': anthropic(3, 15, 0.30),
  'claude-haiku-5-5': { ...anthropic(0.10, 0.50, 0.01), long: { above: 100000, ...anthropic(0.50, 2.50, 0.05) } },
  'claude-haiku-4-5': anthropic(1, 5, 0.10),
  // OpenAI: GPT-6, GPT-5.x and Codex
  'gpt-6.2-astra': openai(8, 0.40, 40, [16, 0.80, 60]), 'gpt-6.2-sol': openai(2, 0.10, 10, [4, 0.20, 15]),
  'gpt-6-astra': openai(10, 1, 50, [20, 2, 75]), 'gpt-6.1-sol': openai(2, 0.10, 10, [4, 0.20, 15]),
  'gpt-6.1-terra': openai(1, 0.05, 5, [2, 0.10, 7.50]), 'gpt-6-luna': openai(0.10, 0.01, 0.50, [0.20, 0.02, 0.75]),
  'gpt-6-sol': openai(2, 0.20, 10, [4, 0.40, 15]),
  'gpt-5.6-sol': openai(4, 0.40, 20, [8, 0.80, 30]), 'gpt-5.6-terra': openai(2, 0.20, 12, [4, 0.40, 18]),
  'gpt-5.6-luna': openai(0.20, 0.02, 1.20, [0.40, 0.04, 1.80]),
  'gpt-5.5': openai(5, 0.50, 30, [10, 1, 45]), 'gpt-5.5-pro': openai(30, NO_CACHE_DISCOUNT(30), 180, [60, NO_CACHE_DISCOUNT(60), 270]),
  'gpt-5.4': openai(2.50, 0.25, 15, [5, 0.50, 22.50]), 'gpt-5.4-pro': openai(30, NO_CACHE_DISCOUNT(30), 180, [60, NO_CACHE_DISCOUNT(60), 270]),
  'gpt-5.4-mini': openai(0.75, 0.075, 4.50), 'gpt-5.4-nano': openai(0.20, 0.02, 1.25),
  'gpt-5.3-codex': openai(1.75, 0.175, 14),
  'gpt-5.2': openai(1.75, 0.175, 14), 'gpt-5.2-pro': openai(21, NO_CACHE_DISCOUNT(21), 168),
  'gpt-5.1': openai(1.25, 0.125, 10), 'gpt-5': openai(1.25, 0.125, 10), 'gpt-5-mini': openai(0.25, 0.025, 2),
  'gpt-5-nano': openai(0.05, 0.005, 0.40), 'gpt-5-pro': openai(15, NO_CACHE_DISCOUNT(15), 120),
};

// a model id as the table writes it: without a provider prefix ("openai/…", Bedrock's "us.anthropic.…"), a date or
// version suffix ("-20250514", "@20250514", "-v1:0"), or the 1M-window mark ("[1m]")
function priceKey(model) {
  if (typeof model !== 'string') return '';
  return model.trim().toLowerCase().split('/').pop()
    .replace(/^(?:[a-z]{2,4}\.)?anthropic\./, '')
    .replace(/\[1m]$/, '')
    .replace(/-v\d+(?::\d+)?$/, '') // (the version comes after the date: "…-20251001-v1:0")
    .replace(/(?:-|@)\d{8}$/, '');
}

const PRICE_FIELDS = ['input', 'output', 'cache_read', 'cache_write', 'cache_write_1h'];
const isPrice = value => !!value && typeof value === 'object' && ['input', 'output'].every(name => Number.isFinite(value[name]) && value[name] >= 0);

// a price from prices.json: input and output are needed; a missing cache price is the input price (no discount, no
// write premium), a missing 1-hour write the 5-minute one
function priceFromFile(value) {
  const price = Object.fromEntries(PRICE_FIELDS.filter(name => Number.isFinite(value[name]) && value[name] >= 0).map(name => [name, value[name]]));
  price.cache_read ??= price.input;
  price.cache_write ??= price.input;
  price.cache_write_1h ??= price.cache_write;
  if (isPrice(value.long) && Number.isFinite(value.long.above)) price.long = { above: value.long.above, ...priceFromFile(value.long) };
  return price;
}

// the built-in table with prices.json on top (read once; a broken file is ignored and said in the server's log)
let prices = null;
function priceTable() {
  if (prices) return prices;
  prices = { ...BUILT_IN_PRICES };
  try {
    const file = JSON.parse(fs.readFileSync(PRICES_FILE, 'utf8'));
    for (const [model, value] of Object.entries(file)) if (isPrice(value)) prices[priceKey(model)] = priceFromFile(value);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`prices.json was not read: ${error.message}`);
  }
  return prices;
}

const priceOf = model => priceTable()[priceKey(model)] || null;
const count = value => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0);
const TOKENS_PER_PRICE = 1000000;

// what one model response cost at the model's API prices, in USD; null when the model has no price
function estimateStepCost(model, tokens) {
  const price = priceOf(model);
  if (!price || !tokens) return null;
  const input = count(tokens.input), cacheRead = count(tokens.cache_read), cacheWrite = count(tokens.cache_write);
  const rate = price.long && input + cacheRead + cacheWrite > price.long.above ? price.long : price;
  const hourWrites = Math.min(count(tokens.cache_write_1h), cacheWrite);
  return (input * rate.input + count(tokens.output) * rate.output + cacheRead * rate.cache_read
    + (cacheWrite - hourWrites) * rate.cache_write + hourWrites * rate.cache_write_1h) / TOKENS_PER_PRICE;
}

module.exports = { BUILT_IN_PRICES, PRICES_FILE, priceKey, priceOf, estimateStepCost };
