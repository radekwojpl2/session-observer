#!/usr/bin/env node
// Static checks run in CI: every JSON file parses, every JS file compiles,
// every hook command points at a script that exists, and versions are sane.
// Zero dependencies. Exit 1 on any failure.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['.git', 'node_modules', '.idea']);
const errors = [];
const fail = msg => errors.push(msg);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const files = walk(ROOT);

// 1. JSON parses
for (const f of files.filter(f => f.endsWith('.json'))) {
  try { JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { fail(`${rel(f)}: invalid JSON (${e.message})`); }
}

// 2. JS compiles
for (const f of files.filter(f => f.endsWith('.js'))) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) fail(`${rel(f)}: syntax error\n${r.stderr}`);
}

// 3. Inline <script> in the dashboard compiles, and the files it loads are the ones in server/dashboard
const html = fs.readFileSync(path.join(ROOT, 'server', 'dashboard.html'), 'utf8');
[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].forEach((m, i) => {
  try { new Function(m[1]); } catch (e) { fail(`server/dashboard.html: inline script #${i + 1} does not parse (${e.message})`); }
});

// data: URIs (the inline tab icon) are not files
const refs = [...html.matchAll(/<(?:script[^>]*[ ]src|link[^>]*[ ]href)="([^"]+)"/g)].map(m => m[1]).filter(r => !r.startsWith('data:'));
for (const r of refs) if (!fs.existsSync(path.join(ROOT, 'server', r))) fail(`server/dashboard.html: ${r} does not exist`);
for (const f of walk(path.join(ROOT, 'server', 'dashboard')).map(p => rel(p).slice('server/'.length))) {
  if (!refs.includes(f)) fail(`server/${f}: not loaded by server/dashboard.html`);
}
// each script is strict on its own (they are separate files, so one 'use strict' no longer covers them all)
for (const r of refs.filter(r => r.endsWith('.js'))) {
  const f = path.join(ROOT, 'server', r);
  if (fs.existsSync(f) && !/^'use strict';/.test(fs.readFileSync(f, 'utf8'))) fail(`server/${r}: must start with 'use strict';`);
}

// 4. Hook commands reference existing scripts and never block the agent: Claude Code's hooks (hooks.json) and
//    Codex's (inline in .codex-plugin/plugin.json, as Codex's own plugins write them; their commands also name their
//    agent so the dashboard can tell the sessions apart)
const readHooks = name => JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', name), 'utf8')).hooks || {};
function checkHooks(name, hooks, rootReference, commandEnd) {
  for (const [event, groups] of Object.entries(hooks)) {
    for (const g of groups) for (const h of g.hooks || []) {
      if (h.type !== 'command') continue;
      const scripts = h.command.split(rootReference + '/').slice(1).map(rest => rest.split(/["'\s]/)[0]);
      if (!scripts.length) fail(`${name} ${event}: the command must start from ${rootReference}`);
      for (const script of scripts) if (!fs.existsSync(path.join(ROOT, script))) fail(`${name} ${event}: missing ${script}`);
      if (h.async !== true) fail(`${name} ${event}: hook must be async so it never blocks the agent`);
      if (!h.command.endsWith(event + commandEnd)) fail(`${name} ${event}: the command must end with "${event}${commandEnd}"`);
    }
  }
}
const hooks = readHooks('hooks.json');
checkHooks('hooks.json', hooks, '${CLAUDE_PLUGIN_ROOT}', '');
const codexPlugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.codex-plugin', 'plugin.json'), 'utf8'));
const codexHooks = codexPlugin.hooks?.hooks || {};
if (!Object.keys(codexHooks).length) fail('.codex-plugin/plugin.json: no hooks under "hooks": { "hooks": { … } }');
checkHooks('.codex-plugin/plugin.json', codexHooks, '${PLUGIN_ROOT}', ' --agent codex');

// 5. Version is semver, and is the one the last release set (release-please writes both files in its release PR)
const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(plugin.version || '')) fail(`plugin.json: version "${plugin.version}" is not semver`);
const released = JSON.parse(fs.readFileSync(path.join(ROOT, '.release-please-manifest.json'), 'utf8'))['.'];
if (plugin.version !== released) {
  fail(`plugin.json: version "${plugin.version}" differs from the released version "${released}" in .release-please-manifest.json.` +
    ' The version is set by the release PR; do not edit it by hand');
}
if (codexPlugin.version !== plugin.version) fail(`.codex-plugin/plugin.json: version "${codexPlugin.version}" differs from "${plugin.version}"`);
if (codexPlugin.name !== plugin.name) fail('.codex-plugin/plugin.json: name differs from .claude-plugin/plugin.json');

// 6. Every dashboard language has exactly the English keys, each the same kind of value (text, function or group),
//    and every function returns text. LANGUAGE_NAMES (the language menu) and the tables name the same languages.
{
  const dir = path.join(ROOT, 'server', 'dashboard', 'building-blocks', 'language');
  const tables = fs.readdirSync(path.join(dir, 'translations')).filter(f => /^[a-z]{2}\.js$/.test(f)).map(f => 'translations/' + f);
  let got = null;
  try { got = new Function(['i18n.js', ...tables].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n') + '\nreturn { TRANSLATIONS, LANGUAGE_NAMES };')(); }
  catch (e) { fail(`server/dashboard/building-blocks/language: the language tables do not load (${e.message})`); }
  if (got) {
    const { TRANSLATIONS, LANGUAGE_NAMES } = got;
    const kind = v => typeof v === 'function' ? 'function' : v && typeof v === 'object' ? 'group' : typeof v;
    const compare = (en, x, code, at = '') => {
      for (const [k, v] of Object.entries(en)) {
        const key = at + k;
        if (!(k in x)) { fail(`translations/${code}.js: missing "${key}"`); continue; }
        if (kind(v) !== kind(x[k])) { fail(`translations/${code}.js: "${key}" is a ${kind(x[k])}, English has a ${kind(v)}`); continue; }
        if (kind(v) === 'group') compare(v, x[k], code, key + '.');
        if (kind(v) === 'function') for (const n of [0, 1, 2, 5, 22]) {
          let r; try { r = x[k](n, n, n); } catch (e) { r = e; }
          if (typeof r !== 'string' || !r) { fail(`translations/${code}.js: "${key}"(${n}) does not return text`); break; }
        }
      }
      for (const k of Object.keys(x)) if (!(k in en)) fail(`translations/${code}.js: "${at + k}" is not in English`);
    };
    for (const code of Object.keys(TRANSLATIONS)) {
      if (!LANGUAGE_NAMES[code]) fail(`translations/${code}.js: language "${code}" is not in LANGUAGE_NAMES (building-blocks/language/i18n.js)`);
      compare(TRANSLATIONS.en, TRANSLATIONS[code], code);
    }
    for (const code of Object.keys(LANGUAGE_NAMES)) if (!TRANSLATIONS[code]) fail(`building-blocks/language/i18n.js: LANGUAGE_NAMES has "${code}" but there is no translations/${code}.js`);
  }
}

// 7. In CI on a pull request: the title is a Conventional Commit. A squash merge puts it on main, where
//    release-please reads it to pick the next version and write the changelog.
const title = process.env.PR_TITLE;
if (title && !/^(feat|fix|perf|refactor|revert|docs|test|ci|chore|build|style)(\([^)]+\))?!?: \S/.test(title)) {
  fail(`PR title "${title}" is not a Conventional Commit, e.g. "feat: …", "fix: …", "refactor: …", "docs: …" (add "!" for a breaking change)`);
}

if (errors.length) {
  console.error(`✘ ${errors.length} problem(s):\n` + errors.map(e => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log(`✔ checks passed (${files.length} files, ${Object.keys(hooks).length} + ${Object.keys(codexHooks).length} hook events, v${plugin.version})`);
