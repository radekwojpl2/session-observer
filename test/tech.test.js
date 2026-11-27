// Language / tool detection for the dashboard's badges (building-blocks/tech-badges.js, and features/events/model/tool-techs.js
// for a whole tool call). The dashboard's scripts are plain browser scripts, so this evaluates them in the page's order
// with the building blocks they read (the English text table, formatting, tool groups).
// Zero dependencies — run with `node --test test/tech.test.js`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = file => fs.readFileSync(path.join(__dirname, '..', 'server', 'dashboard', file), 'utf8');
const SCRIPTS = [
  'building-blocks/language/i18n.js', 'building-blocks/language/translations/en.js', 'building-blocks/language/selected-language.js',
  'building-blocks/format.js', 'building-blocks/tech-badges.js', 'features/agents/model/agents.js', 'features/events/model/tool-groups.js', 'features/events/model/tool-techs.js',
];
const EXPORTS = 'TECH_BADGES, BADGE_SHAPES, TECH_BY_EXTENSION, TECH_BY_PROGRAM, TECH_BY_FILE_NAME, techOfFile, techOfProgram, splitShellCommands, '
  + 'programOfCommand, techsOfToolCall, firstTechOfToolCall, techBadgeMark, techBadgeIcon, techBadgeIcons';
// the agents as the server lists them (/api/agents)
const dashboard = new Function('AGENT_LIST', SCRIPTS.map(source).join('\n') + `\nsetAgents(AGENT_LIST);\nreturn { ${EXPORTS} };`)(
  require('../server/lib/features/agents/registry').publicAgents());

const techOfCommand = (command, tool = 'Bash') => dashboard.firstTechOfToolCall(tool, { command });
const techOfPath = (file_path, tool = 'Edit') => dashboard.firstTechOfToolCall(tool, { file_path });

test('shell commands: the program being run', () => {
  assert.equal(techOfCommand('node scripts/seed.js'), 'node');
  assert.equal(techOfCommand("node -e 'console.log(1)'"), 'node');
  assert.equal(techOfCommand('dotnet build -c Release'), 'dotnet');
  assert.equal(techOfCommand('dotnet test && git status'), 'dotnet');
  assert.equal(techOfCommand('npm test'), 'npm');
  assert.equal(techOfCommand('npx tsc --noEmit'), 'npm');
  assert.equal(techOfCommand('python3 -m pytest -q'), 'py');
  assert.equal(techOfCommand('pip install -r requirements.txt'), 'py');
  assert.equal(techOfCommand('docker compose up -d redis'), 'docker');
  assert.equal(techOfCommand('./gradlew assembleDebug'), 'gradle');
  assert.equal(techOfCommand('cargo build --release'), 'rs');
  assert.equal(techOfCommand('go test ./...'), 'go');
  assert.equal(techOfCommand('git status'), 'git');
  assert.equal(techOfCommand('gh pr view 5'), 'github');
  assert.equal(techOfCommand('kubectl get pods'), 'k8s');
});

test('shell commands: what comes before the program is skipped', () => {
  assert.equal(techOfCommand('cd api && dotnet test'), 'dotnet');
  assert.equal(techOfCommand('cd /d/git/app; NODE_ENV=test node run.js'), 'node');
  assert.equal(techOfCommand('sudo docker ps'), 'docker');
  assert.equal(techOfCommand('timeout 30 node server.js'), 'node');
  assert.equal(techOfCommand('cat data.json | jq .name'), 'json');
  assert.equal(techOfCommand('"C:\\Program Files\\dotnet\\dotnet.exe" --info'), 'dotnet');
  assert.equal(techOfCommand('/usr/local/bin/python3.12 app.py'), 'py');
  assert.equal(techOfCommand('for f in *.cs; do dotnet format "$f"; done'), 'dotnet');
  assert.equal(techOfCommand('./build.ps1 -Configuration Release'), 'ps');
  assert.equal(techOfCommand('# build it\ndotnet build'), 'dotnet');
  assert.equal(techOfCommand('JAVA_HOME="/d/JetBrains Rider 2024.2.7/jbr" ./gradlew test --console=plain 2>&1 | tail -30'), 'gradle');
  assert.equal(techOfCommand('"$R/jbr/bin/java.exe" -version'), 'java');
  assert.equal(techOfCommand('OUT=$(ls -d build) dotnet publish -o "$OUT"'), 'dotnet');
  assert.equal(techOfCommand('X=$(dirname node) ; ls'), null);
});

test('shell commands: names inside quotes, heredocs and arguments do not count', () => {
  assert.equal(techOfCommand('echo "run npm install; then node app"'), null);
  assert.equal(techOfCommand('ls -la && cat README.md'), null);
  assert.equal(techOfCommand('grep -rn "dotnet" docs'), null);
  assert.equal(techOfCommand("cat > notes.txt <<'EOF'\nnode is great; python too\nEOF"), null);
  assert.equal(techOfCommand("python3 - <<'EOF'\nimport os; print(os.getcwd())\nEOF"), 'py');
  assert.equal(techOfCommand('echo done 2>&1'), null);
  assert.equal(techOfCommand(''), null);
  assert.equal(techOfCommand(undefined), null);
});

test('chained commands: every program in the chain, each once, in order', () => {
  const allTechs = (command, tool = 'Bash') => dashboard.techsOfToolCall(tool, { command });
  assert.deepEqual(allTechs('cd api && npm ci && dotnet build && dotnet test'), ['npm', 'dotnet']);
  assert.deepEqual(allTechs('git stash && dotnet test; git stash pop'), ['git', 'dotnet']);
  assert.deepEqual(allTechs('npm run build && docker build -t app . && docker push app && kubectl rollout restart deploy/app'), ['npm', 'docker', 'k8s']);
  assert.deepEqual(allTechs('cat data.json | jq .name | node fmt.js'), ['json', 'node']);
  assert.deepEqual(allTechs('ls -la && cat README.md'), []);
  assert.deepEqual(allTechs('Get-ChildItem', 'PowerShell'), ['ps']);
  assert.deepEqual(allTechs('dotnet build; if ($?) { node post.js }', 'PowerShell'), ['dotnet', 'node']);
  assert.deepEqual(dashboard.techsOfToolCall('Edit', { file_path: 'src/Orders/OrderService.cs' }), ['cs']);
  assert.deepEqual(dashboard.techsOfToolCall('WebFetch', { url: 'https://example.com' }), []);
  // the first one is what techOf gives (the badge a Route stop is drawn with)
  assert.equal(techOfCommand('git stash && dotnet test'), 'git');
  // badges in a row: at most three, then "+n"
  assert.equal((dashboard.techBadgeIcons(['npm', 'docker', 'k8s']).match(/<svg/g) || []).length, 3);
  assert.match(dashboard.techBadgeIcons(['npm', 'docker', 'k8s', 'git', 'node']), /class="tmore" title="Git, Node\.js">\+2<\/span>$/);
  assert.equal(dashboard.techBadgeIcons([]), '');
});

test('the PowerShell tool: its own badge unless the command runs a known program', () => {
  assert.equal(techOfCommand('Get-ChildItem -Recurse', 'PowerShell'), 'ps');
  assert.equal(techOfCommand('dotnet build; if ($?) { dotnet test }', 'PowerShell'), 'dotnet');
  assert.equal(techOfCommand("$env:ASPNETCORE_ENVIRONMENT='Development'; dotnet run", 'PowerShell'), 'dotnet');
  assert.equal(techOfCommand('& "C:\\Program Files\\nodejs\\node.exe" -v', 'PowerShell'), 'node');
});

test('files: the language by extension', () => {
  assert.equal(techOfPath('D:\\git\\app\\src\\Orders\\OrderService.cs'), 'cs');
  assert.equal(techOfPath('/home/me/app/src/index.ts'), 'ts');
  assert.equal(techOfPath('src/App.tsx'), 'react');
  assert.equal(techOfPath('app/src/main/java/Main.kt'), 'kt');
  assert.equal(techOfPath('server/dashboard.html'), 'html');
  assert.equal(techOfPath('scripts/hook.js'), 'js');
  assert.equal(techOfPath('README.md'), 'md');
  assert.equal(techOfPath('deploy/values.yaml'), 'yaml');
  assert.equal(techOfPath('db/001_init.sql', 'Write'), 'sql');
  assert.equal(techOfPath('notes.txt'), null);
  assert.equal(techOfPath('LICENSE'), null);
  assert.equal(techOfPath(undefined), null);
});

test('files: names that say more than their extension', () => {
  assert.equal(techOfPath('api/Api.csproj'), 'dotnet');
  assert.equal(techOfPath('App.sln'), 'dotnet');
  assert.equal(techOfPath('src/Api/appsettings.Development.json'), 'dotnet');
  assert.equal(techOfPath('package.json'), 'npm');
  assert.equal(techOfPath('tsconfig.build.json'), 'ts');
  assert.equal(techOfPath('Dockerfile'), 'docker');
  assert.equal(techOfPath('docker-compose.override.yml'), 'docker');
  assert.equal(techOfPath('app/build.gradle.kts'), 'gradle');
  assert.equal(techOfPath('Cargo.toml'), 'rs');
  assert.equal(techOfPath('.github/workflows/ci.yml'), 'github');
  assert.equal(techOfPath('.gitignore'), 'git');
});

test('Glob and Grep: the language they look for', () => {
  assert.equal(dashboard.firstTechOfToolCall('Glob', { pattern: 'src/**/*.cs' }), 'cs');
  assert.equal(dashboard.firstTechOfToolCall('Glob', { pattern: '**/*.{ts,tsx}' }), 'ts');
  assert.equal(dashboard.firstTechOfToolCall('Glob', { pattern: '**/*' }), null);
  assert.equal(dashboard.firstTechOfToolCall('Grep', { pattern: 'TODO', glob: '*.py' }), 'py');
  assert.equal(dashboard.firstTechOfToolCall('Grep', { pattern: 'fn main', type: 'rust' }), 'rs');
  assert.equal(dashboard.firstTechOfToolCall('Grep', { pattern: 'x', path: 'server/dashboard.html' }), 'html');
  assert.equal(dashboard.firstTechOfToolCall('Grep', { pattern: 'x', path: 'src' }), null);
});

test('other tools have no badge', () => {
  assert.equal(dashboard.firstTechOfToolCall('WebFetch', { url: 'https://nodejs.org/api/fs.js' }), null);
  assert.equal(dashboard.firstTechOfToolCall('Agent', { description: 'check the node version' }), null);
  assert.equal(dashboard.firstTechOfToolCall(undefined, {}), null);
});

test('every id used by a table has a badge, and every badge draws', () => {
  const ids = new Set([...Object.values(dashboard.TECH_BY_EXTENSION), ...dashboard.TECH_BY_PROGRAM.map(([, id]) => id), ...dashboard.TECH_BY_FILE_NAME.map(([, id]) => id), 'github', 'ps']);
  for (const id of ids) assert.ok(dashboard.TECH_BADGES[id], `no badge for "${id}"`);
  for (const [id, badge] of Object.entries(dashboard.TECH_BADGES)) {
    for (const field of ['name', 'shape', 'background', 'foreground', 'mark']) assert.ok(badge[field], `${id}: no ${field}`);
    assert.ok(dashboard.BADGE_SHAPES[badge.shape], `${id}: unknown shape ${badge.shape}`);
    const svg = dashboard.techBadgeIcon(id);
    assert.match(svg, /^<svg class="ic tech"[\s\S]*<\/svg>$/, id);
    assert.ok(svg.includes(`<title>${badge.name.replace(/&/g, '&amp;')}</title>`), id);
  }
  assert.equal(dashboard.techBadgeIcon('nope'), '');
  assert.equal(dashboard.techBadgeIcon(null), '');
  // a monogram is escaped text, a glyph is passed through as SVG
  assert.match(dashboard.techBadgeMark('xml'), /&lt;&gt;<\/text>/);
  assert.match(dashboard.techBadgeMark('ps'), /^<g [^>]*><path /);
});
