'use strict';
// The dashboard's markdown renderer (server/dashboard/building-blocks/markdown.js): what agents write, made readable,
// and nothing but its own tags let through.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({});
for (const file of ['building-blocks/format.js', 'building-blocks/markdown.js']) {
  const source = fs.readFileSync(path.join(__dirname, '../server/dashboard', file), 'utf8');
  // format.js reads its units and decimal sign from the chosen language at load
  vm.runInContext(file.endsWith('format.js') ? `const TEXT = { units: {}, decimalSeparator: '.' };\n${source}` : source, context, { filename: file });
}
const markdown = text => vm.runInContext(`markdownHtml(${JSON.stringify(text)})`, context);

test('paragraphs, headings, and inline code, bold, italic and links', () => {
  assert.equal(markdown('# Plan\n\nRun `npm test` **first**, then *check*.\nSee [docs](https://x.y).'),
    '<div class="md-h md-h1">Plan</div><p>Run <code>npm test</code> <b>first</b>, then <i>check</i>.<br>See <u title="https://x.y">docs</u>.</p>');
});

test('bullet and numbered lists, with nested and wrapped items', () => {
  assert.equal(markdown('- one\n  - nested\n- two\n  carried on\n\n1. first\n2. second'),
    '<ul><li>one</li><li style="margin-left:1.2em">nested</li><li>two carried on</li></ul><ol><li>first</li><li>second</li></ol>');
});

test('fenced code is kept as it is, and escaped', () => {
  assert.equal(markdown('```js\nif (a < b) **x**\n```\nafter'), '<pre>if (a &lt; b) **x**</pre><p>after</p>');
});

test('tables, quotes and rules', () => {
  assert.equal(markdown('| a | b |\n|---|:-:|\n| 1 | `2` |'),
    '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td><code>2</code></td></tr></tbody></table>');
  assert.equal(markdown('> quoted **bold**\n\n---'), '<blockquote><p>quoted <b>bold</b></p></blockquote><hr>');
});

test('HTML in the text is shown as text, never run', () => {
  const html = markdown('<img src=x onerror=alert(1)> and [x](javascript:alert(1)) <script>');
  assert.ok(!/<img|<script/.test(html), html);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('href'), 'links are shown as text, not followed');
});
