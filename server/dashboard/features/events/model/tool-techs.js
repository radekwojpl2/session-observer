'use strict';
// Session Observer dashboard — what a tool call works with: the badges (building-blocks/tech-badges.js) for its files
// or the programs its command runs.
// What a tool call works with → badge ids, in the order they appear. A chained shell line can run several programs:
// `cd api && npm ci && dotnet test` is npm and .NET. Empty when there is nothing specific to show.
function techsOfToolCall(tool, input) {
  input = input || {};
  if (!tool) return [];
  if (SHELL_TOOLS.has(tool)) {
    const programs = splitShellCommands(input.command).map(command => techOfProgram(programOfCommand(command))).filter(Boolean);
    const unique = [...new Set(programs)];
    if (unique.length) return unique;
    return tool === 'PowerShell' ? ['ps'] : [];
  }
  let tech = null;
  if (tool === 'Glob') tech = techOfFile(input.pattern);
  else if (tool === 'Grep') {
    const type = String(input.type || '').toLowerCase();
    tech = techOfFile(input.glob) || TECH_BY_EXTENSION[TECH_BY_RIPGREP_TYPE[type] || type] || techOfFile(input.path);
  } else if (FILE_TOOLS.has(tool)) tech = techOfFile(filesOfToolCall(tool, input)[0] || input.path);
  return tech ? [tech] : [];
}

// the first of them (the one a Route stop is drawn with), or null
const firstTechOfToolCall = (tool, input) => techsOfToolCall(tool, input)[0] || null;
