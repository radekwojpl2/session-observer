'use strict';
// Session Observer dashboard — language and tool badges: the language of a file (C#, Kotlin, HTML…) or the program a
// shell command runs (node, dotnet, docker…), and its badge. Each badge is drawn right here — its usual colour, a
// shape and a monogram or a small glyph — so there are no image files and nothing is downloaded.
// mark: a monogram, or a glyph (SVG in the 24×24 box, drawn in the foreground colour)
const badge = (name, shape, background, foreground, mark) => ({ name, shape, background, foreground, mark });
const TECH_BADGES = {
  js: badge('JavaScript', 'square', '#f7df1e', '#1b1d22', 'JS'),
  ts: badge('TypeScript', 'square', '#3178c6', '#fff', 'TS'),
  react: badge('React', 'circle', '#20232a', '#61dafb', '<g stroke-width="1.2"><ellipse cx="12" cy="12" rx="8.6" ry="3.3"/><ellipse cx="12" cy="12" rx="8.6" ry="3.3" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="8.6" ry="3.3" transform="rotate(120 12 12)"/></g><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
  vue: badge('Vue', 'square', '#42b883', '#fff', 'V'),
  svelte: badge('Svelte', 'square', '#ff3e00', '#fff', 'S'),
  node: badge('Node.js', 'hexagon', '#3c873a', '#fff', 'JS'),
  npm: badge('npm', 'square', '#cb3837', '#fff', 'npm'),
  pnpm: badge('pnpm', 'square', '#f69220', '#1b1d22', 'pn'),
  yarn: badge('Yarn', 'circle', '#2c8ebb', '#fff', 'Y'),
  bun: badge('Bun', 'circle', '#fbf0df', '#3b2a1a', 'bun'),
  deno: badge('Deno', 'circle', '#1b1d22', '#fff', 'D'),
  cs: badge('C#', 'hexagon', '#68217a', '#fff', 'C#'),
  dotnet: badge('.NET', 'square', '#512bd4', '#fff', '.NET'),
  fs: badge('F#', 'hexagon', '#378bba', '#fff', 'F#'),
  vb: badge('Visual Basic', 'square', '#00539c', '#fff', 'VB'),
  py: badge('Python', 'square', '#3776ab', '#ffd43b', 'Py'),
  kt: badge('Kotlin', 'square', '#7f52ff', '#fff', 'K'),
  java: badge('Java', 'square', '#e76f00', '#fff', 'J'),
  gradle: badge('Gradle', 'square', '#02303a', '#00de7a', 'G'),
  maven: badge('Maven', 'square', '#c71a36', '#fff', 'mvn'),
  go: badge('Go', 'square', '#00add8', '#fff', 'GO'),
  rs: badge('Rust', 'circle', '#b7410e', '#fff', 'Rs'),
  c: badge('C', 'hexagon', '#5c6bc0', '#fff', 'C'),
  cpp: badge('C++', 'hexagon', '#00599c', '#fff', 'C++'),
  rb: badge('Ruby', 'square', '#cc342d', '#fff', 'Rb'),
  php: badge('PHP', 'circle', '#777bb4', '#fff', 'php'),
  swift: badge('Swift', 'square', '#f05138', '#fff', 'Sw'),
  dart: badge('Dart', 'square', '#0175c2', '#fff', 'Da'),
  html: badge('HTML', 'shield', '#e34f26', '#fff', '5'),
  css: badge('CSS', 'shield', '#1572b6', '#fff', '3'),
  sass: badge('Sass', 'circle', '#cc6699', '#fff', 'S'),
  json: badge('JSON', 'square', '#3f3f46', '#facc15', '{}'),
  yaml: badge('YAML', 'square', '#cb171e', '#fff', 'yml'),
  toml: badge('TOML', 'square', '#9c4221', '#fff', 'T'),
  xml: badge('XML', 'square', '#0b7285', '#fff', '<>'),
  md: badge('Markdown', 'square', '#083fa1', '#fff', 'M↓'),
  sql: badge('SQL', 'square', '#336791', '#fff', '<g stroke-width="1.6"><ellipse cx="12" cy="7.5" rx="6" ry="2.5"/><path d="M6 7.5v9c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-9M6 12c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5"/></g>'),
  sh: badge('Shell script', 'square', '#4eaa25', '#fff', '$_'),
  ps: badge('PowerShell', 'square', '#2671be', '#fff', '<path d="M7 7.5l5.5 4.5L7 16.5M13 16.5h4.5"/>'),
  docker: badge('Docker', 'square', '#1d63ed', '#fff', '<g fill="currentColor" stroke="none"><rect x="5.5" y="9.5" width="3" height="3" rx=".5"/><rect x="9.5" y="9.5" width="3" height="3" rx=".5"/><rect x="13.5" y="9.5" width="3" height="3" rx=".5"/><rect x="9.5" y="5.5" width="3" height="3" rx=".5"/><path d="M4 14h16c-.4 3.2-3 5-7.5 5S4.6 17.2 4 14z"/></g>'),
  k8s: badge('Kubernetes', 'hexagon', '#326ce5', '#fff', 'K8'),
  git: badge('Git', 'diamond', '#f05032', '#fff', '<g stroke-width="1.6"><circle cx="9.5" cy="8" r="1.5"/><circle cx="9.5" cy="16" r="1.5"/><circle cx="15" cy="11" r="1.5"/><path d="M9.5 9.5v5M15 12.5c0 2-2.5 2-4.2 2.6"/></g>'),
  github: badge('GitHub', 'circle', '#24292f', '#fff', 'GH'),
  azure: badge('Azure', 'square', '#0078d4', '#fff', 'Az'),
  aws: badge('AWS', 'square', '#232f3e', '#ff9900', 'aws'),
  tf: badge('Terraform', 'square', '#7b42bc', '#fff', 'TF'),
  lua: badge('Lua', 'circle', '#000080', '#fff', 'Lua'),
  r: badge('R', 'circle', '#276dc3', '#fff', 'R'),
  scala: badge('Scala', 'square', '#dc322f', '#fff', 'Sc'),
  ex: badge('Elixir', 'square', '#4b275f', '#fff', 'Ex'),
  zig: badge('Zig', 'square', '#f7a41d', '#1b1d22', 'Z'),
  perl: badge('Perl', 'square', '#39457e', '#fff', 'Pl'),
};
const BADGE_SHAPES = {
  square: '<rect x="1.5" y="1.5" width="21" height="21" rx="4.5"/>',
  circle: '<circle cx="12" cy="12" r="10.75"/>',
  hexagon: '<path d="M12 1l9.5 5.5v11L12 23l-9.5-5.5v-11z"/>',
  shield: '<path d="M2.5 1.5h19l-1.7 17.6L12 22.5l-7.8-3.4z"/>',
  diamond: '<path d="M12 1.2L22.8 12 12 22.8 1.2 12z"/>',
};

// file extension → badge id
const TECH_BY_EXTENSION = {};
const EXTENSIONS_BY_TECH = {
  js: 'js mjs cjs', ts: 'ts mts cts', react: 'jsx tsx', vue: 'vue', svelte: 'svelte',
  cs: 'cs csx cshtml razor', dotnet: 'csproj sln slnx fsproj vbproj props targets nuspec', fs: 'fs fsx fsi', vb: 'vb',
  py: 'py pyi pyw ipynb', kt: 'kt kts', java: 'java', gradle: 'gradle', go: 'go', rs: 'rs', c: 'c h', cpp: 'cpp cc cxx hpp hh hxx',
  rb: 'rb erb gemspec', php: 'php', swift: 'swift', dart: 'dart', html: 'html htm', css: 'css', sass: 'scss sass',
  json: 'json jsonc json5 jsonl', yaml: 'yml yaml', toml: 'toml', xml: 'xml xaml xsd xslt svg', md: 'md mdx markdown', sql: 'sql',
  sh: 'sh bash zsh', ps: 'ps1 psm1 psd1', tf: 'tf tfvars', lua: 'lua', r: 'r', scala: 'scala', ex: 'ex exs', zig: 'zig', perl: 'pl pm',
};
for (const [tech, extensions] of Object.entries(EXTENSIONS_BY_TECH)) {
  for (const extension of extensions.split(' ')) TECH_BY_EXTENSION[extension] = tech;
}
// names ripgrep uses for a file type (Grep's `type`) where they differ from the extension
const TECH_BY_RIPGREP_TYPE = { rust: 'rs', csharp: 'cs', kotlin: 'kt', ruby: 'rb', markdown: 'md', python: 'py', typescript: 'ts', javascript: 'js', shell: 'sh' };
// whole file names that say more than their extension does: [pattern, badge id]
const TECH_BY_FILE_NAME = [
  [/^dockerfile(\..+)?$|^(docker-)?compose.*\.ya?ml$|^\.dockerignore$/, 'docker'],
  [/^package(-lock)?\.json$|^\.npmrc$/, 'npm'], [/^pnpm-(lock|workspace)\.yaml$/, 'pnpm'], [/^yarn\.lock$|^\.yarnrc(\.yml)?$/, 'yarn'],
  [/^tsconfig.*\.json$/, 'ts'], [/\.gradle\.kts$|^gradlew(\.bat)?$|^gradle\.properties$/, 'gradle'], [/^pom\.xml$/, 'maven'],
  [/^cargo\.(toml|lock)$/, 'rs'], [/^go\.(mod|sum|work)$/, 'go'], [/^(requirements.*\.txt|pyproject\.toml|pipfile|uv\.lock)$/, 'py'],
  [/^(gemfile|rakefile)(\.lock)?$/, 'rb'], [/^composer\.(json|lock)$/, 'php'],
  [/^(appsettings.*\.json|global\.json|nuget\.config|launchsettings\.json|packages\.lock\.json)$/, 'dotnet'],
  [/^\.git(ignore|attributes|modules)$/, 'git'],
];

// the language of a file path (also of a glob such as src/**/*.cs or *.{ts,tsx}); null when it is not a known one
function techOfFile(filePath) {
  filePath = String(filePath || '');
  // a brace list keeps its first entry: *.{ts,tsx} → *.ts
  const fileName = baseName(filePath).toLowerCase().replace(/\{([^,}]*)[^}]*}/g, '$1');
  if (!fileName) return null;
  for (const [pattern, tech] of TECH_BY_FILE_NAME) if (pattern.test(fileName)) return tech;
  if (/(^|[\\/])\.github[\\/]/.test(filePath)) return 'github';
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? null : TECH_BY_EXTENSION[fileName.slice(dot + 1)] || null;
}

// program name (without its folder and without .exe / .cmd / .bat) → badge id: [pattern, badge id]
const TECH_BY_PROGRAM = [
  [/^dotnet(-[\w-]+)?$|^msbuild$|^nuget$|^csc$/, 'dotnet'],
  [/^node(js)?$/, 'node'], [/^np[mx]$/, 'npm'], [/^pnp[mx]$/, 'pnpm'], [/^yarn$/, 'yarn'], [/^bunx?$/, 'bun'], [/^deno$/, 'deno'], [/^tsc$|^tsx$|^ts-node$/, 'ts'],
  [/^python[\d.]*$|^py$|^pip[\d.]*$|^pipx$|^uvx?$|^poetry$|^pytest$|^conda$/, 'py'],
  [/^go$|^gofmt$/, 'go'], [/^cargo$|^rustc$|^rustup$/, 'rs'], [/^javac?$|^jar$/, 'java'], [/^gradlew?$/, 'gradle'], [/^mvnw?$/, 'maven'], [/^kotlinc?$/, 'kt'],
  [/^docker(-compose)?$|^podman$/, 'docker'], [/^kubectl$|^helm$|^minikube$/, 'k8s'], [/^git$/, 'git'], [/^gh$/, 'github'], [/^pwsh$|^powershell$/, 'ps'],
  [/^ruby$|^gem$|^bundle$|^rake$|^rails$/, 'rb'], [/^php$|^composer$/, 'php'], [/^swiftc?$/, 'swift'], [/^dart$|^flutter$/, 'dart'],
  [/^g?cc$|^clang$/, 'c'], [/^[gc]\+\+$|^clang\+\+$|^cmake$/, 'cpp'], [/^psql$|^sqlite3?$|^mysql$|^sqlcmd$|^pg_dump$/, 'sql'], [/^jq$/, 'json'],
  [/^azd?$/, 'azure'], [/^aws$/, 'aws'], [/^terraform$|^tofu$/, 'tf'], [/^lua$/, 'lua'], [/^rscript$/, 'r'], [/^scala$|^sbt$/, 'scala'],
  [/^elixir$|^mix$|^iex$/, 'ex'], [/^zig$/, 'zig'], [/^perl$/, 'perl'],
];

// a program name (or a script run directly, such as ./build.ps1) → badge id
function techOfProgram(word) {
  const program = baseName(String(word || '')).toLowerCase();
  const withoutExtension = program.replace(/\.(exe|cmd|bat)$/, '');
  for (const [pattern, tech] of TECH_BY_PROGRAM) if (pattern.test(withoutExtension)) return tech;
  return /\.(py|ps1|rb|[cm]?js|ts|php|pl|sh)$/.test(program) ? techOfFile(program) : null;
}

// The separate commands of a shell line: split at ; | & and line ends, but not inside quotes. Comments and heredoc
// bodies (a script handed to another program) are left out.
function splitShellCommands(commandLine) {
  const commands = [];
  let current = '', openQuote = null, heredocEnd = null;
  for (const line of String(commandLine || '').split('\n')) {
    if (heredocEnd) {
      if (line.trim() === heredocEnd) heredocEnd = null;
      continue;
    }
    const heredocStart = !openQuote && line.match(/<<-?\s*(['"]?)(\w+)\1/);
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (openQuote) {
        current += char;
        if (char === '\\' && openQuote === '"') current += line[++index] ?? '';
        else if (char === openQuote) openQuote = null;
        continue;
      }
      if (char === '"' || char === "'") { openQuote = char; current += char; continue; }
      if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) break; // a comment runs to the line end
      if (char === ';' || char === '|' || char === '&') { commands.push(current); current = ''; continue; }
      current += char;
    }
    if (openQuote) current += '\n'; // a quoted string goes on to the next line
    else { commands.push(current); current = ''; }
    if (heredocStart) heredocEnd = heredocStart[2];
  }
  commands.push(current);
  return commands.map(command => command.trim()).filter(Boolean);
}

// words that come before the program actually being run
const WORDS_BEFORE_PROGRAM = new Set(['sudo', 'env', 'time', 'command', 'exec', 'nohup', 'xargs', 'winpty', 'timeout', 'if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '(']);

const isVariableAssignment = word => /^\$?[A-Za-z_][\w:]*=/.test(word);
const isSkippedWord = word => !word || isVariableAssignment(word) || /^-/.test(word) || /^\d+[smhd]?$/.test(word)
  || /^\$[\w?:{}]*$/.test(word) || WORDS_BEFORE_PROGRAM.has(word.toLowerCase());
const countOfChar = (text, char) => text.split(char).length - 1;

// the program one command runs: its first word after variable assignments, options and words like sudo / time
function programOfCommand(command) {
  let subshellDepth = 0; // inside a $( … ) that is part of an assignment: OUT=$(ls -d build) ./run
  for (const rawWord of String(command || '').match(/(?:"[^"]*"|'[^']*'|[^\s"'])+/g) || []) {
    const insideSubshell = subshellDepth > 0;
    const word = rawWord.replace(/^["'(]+|["')]+$/g, '');
    subshellDepth = Math.max(0, subshellDepth + countOfChar(rawWord, '(') - countOfChar(rawWord, ')'));
    if (insideSubshell || isSkippedWord(word)) continue;
    return word;
  }
  return '';
}

// font size and squeeze of a monogram, by its length, so it fits the badge
const MONOGRAM_FONT_SIZES = [15, 15, 12, 9.4, 8];
function monogramSvg(text, color) {
  const length = [...text].length;
  const fontSize = MONOGRAM_FONT_SIZES[length] || 7;
  const squeeze = length > 2 ? ` textLength="${length > 3 ? 18.4 : 16.6}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<text class="tkx" x="12" y="12" dy=".36em" text-anchor="middle" fill="${color}" stroke="none" font-size="${fontSize}"${squeeze}>${escapeHtml(text)}</text>`;
}

// the monogram or glyph alone, in the 24×24 box (the Route draws it on a stop filled with the badge colour)
function techBadgeMark(id) {
  const { foreground, mark } = TECH_BADGES[id];
  const isGlyph = /<\w/.test(mark);
  if (isGlyph) return `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:${foreground}">${mark}</g>`;
  return monogramSvg(mark, foreground);
}

// the whole badge as an inline icon; '' for an unknown id, so callers can fall back to the group icon
function techBadgeIcon(id, className = 'ic') {
  const tech = TECH_BADGES[id];
  if (!tech) return '';
  const name = escapeHtml(tech.name);
  return `<svg class="${className} tech" viewBox="0 0 24 24" role="img" aria-label="${name}"><title>${name}</title>`
    + `<g fill="${tech.background}" stroke="#808080" stroke-opacity=".5" stroke-width=".7">${BADGE_SHAPES[tech.shape]}</g>${techBadgeMark(id)}</svg>`;
}

// several badges in a row (a chained command): the first few, then "+n" for the rest; '' for an empty list
function techBadgeIcons(ids, max = 3) {
  if (!ids || !ids.length) return '';
  const hidden = ids.slice(max);
  const more = hidden.length ? `<span class="tmore" title="${escapeHtml(hidden.map(id => TECH_BADGES[id].name).join(', '))}">+${hidden.length}</span>` : '';
  return ids.slice(0, max).map(id => techBadgeIcon(id)).join('') + more;
}

const techNames = ids => ids.map(id => TECH_BADGES[id].name);
