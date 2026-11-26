'use strict';
// Session Observer dashboard — Context view, what the model is given before the conversation, pinned on top: the
// system prompt (for a custom subagent, the body of its .md file), the tool definitions, the instruction files
// (CLAUDE.md, AGENTS.md, rules, auto-memory), and what it knows it can use: skills and subagent types by name and
// description, MCP server instructions, and deferred tools by name only.
const INSTRUCTION_KINDS = TEXT.instructionKinds;
const mcpServerOf = tool => splitMcpToolName(tool.name)?.[0] || '';
const sumLengths = (list, lengthOf) => list.reduce((sum, entry) => sum + lengthOf(entry), 0);

function systemPromptCardHtml(prompt, idPrefix) {
  const size = `${escapeHtml(TEXT.charsN(formatCompactNumber(prompt.system.length)))} · ${approxTokensLabel(prompt.system.length)}`;
  return contextCardHtml(idPrefix + 'sys', 'sys', cardHeader({ icon: `${iconSvg('core')} `, title: escapeHtml(TEXT.systemPrompt), size }), preText(prompt.system));
}

// built-in tools first, then each MCP server's, largest first
function toolDefinitionsCardHtml(prompt, idPrefix) {
  const groups = groupEntries(prompt.tools.map((tool, index) => ({ ...tool, index })), mcpServerOf, toolDefinitionLength);
  const mcpServers = groups.filter(([server]) => server).length;
  const note = `${escapeHtml(countOf(prompt.tools.length, 'tool'))}${mcpServers ? ` · ${escapeHtml(countOf(mcpServers, 'mcpServer'))}` : ''}`;
  const toolCard = tool => contextCardHtml(idPrefix + 'tool.' + tool.index, 'tdef',
    `<b class="mono">${escapeHtml(splitMcpToolName(tool.name)?.[1] || tool.name)}</b> <span class="muted">${escapeHtml(shorten(tool.description, 100))}</span><span class="grow"></span><span class="sz">${approxTokensLabel(toolDefinitionLength(tool))}</span>`,
    preText(tool.description) + (tool.schema ? `<pre class="code fj">${jsonHtml(tool.schema)}</pre>` : ''));
  const body = groups.map(([server, tools]) => contextGroupHtml(idPrefix + 'tools.g.' + server,
    server ? escapeHtml(server) : escapeHtml(TEXT.builtIn),
    escapeHtml(server ? `MCP · ${countOf(tools.length, 'tool')}` : countOf(tools.length, 'tool')),
    approxTokensLabel(sumLengths(tools, toolDefinitionLength)),
    tools.map(toolCard).join(''))).join('');
  return contextCardHtml(idPrefix + 'tools', 'sys',
    cardHeader({ icon: `${iconSvg('other')} `, title: escapeHtml(TEXT.toolDefs), note, size: approxTokensLabel(sumLengths(prompt.tools, toolDefinitionLength)) }), body);
}

function instructionsCardHtml(files, idPrefix) {
  const note = escapeHtml(files.map(file => file.path.split(/[\\/]/).pop()).join(', '));
  const fileCard = (file, index) => contextCardHtml(idPrefix + 'ins.' + index, 'tdef',
    `<b class="mono">${escapeHtml(file.path)}</b> <span class="muted">${escapeHtml(INSTRUCTION_KINDS[file.type] || file.type || '')}</span><span class="grow"></span><span class="sz">${approxTokensLabel(textLength(file.content))}</span>`,
    preText(file.content));
  return contextCardHtml(idPrefix + 'ins', 'sys',
    cardHeader({ icon: `${iconSvg('core')} `, title: escapeHtml(TEXT.instructions), note, size: approxTokensLabel(sumLengths(files, file => textLength(file.content))) }),
    files.map(fileCard).join(''));
}

// skills by source: a plugin's skills are named "plugin:skill"; the transcript doesn't say where the others come from
const pluginOfSkill = skill => (skill.name.includes(':') ? skill.name.slice(0, skill.name.indexOf(':')) : '');
const CLAUDE_AI_SKILLS_PLUGIN = 'anthropic-skills';

function skillsCardHtml(skills, idPrefix) {
  const groups = groupEntries(skills, pluginOfSkill, skill => listingLength([skill]));
  const plugins = groups.filter(([plugin]) => plugin).length;
  const note = `${escapeHtml(countOf(skills.length, 'skill'))}${plugins ? ` · ${escapeHtml(countOf(plugins, 'plugin'))}` : ''}`;
  const groupNote = (plugin, list) => `${plugin === CLAUDE_AI_SKILLS_PLUGIN ? TEXT.claudeSync + ' · ' : plugin ? TEXT.pluginLc + ' · ' : ''}${countOf(list.length, 'skill')}`;
  const skillLine = plugin => skill => `<div><b class="mono">${escapeHtml(plugin ? skill.name.slice(plugin.length + 1) : skill.name)}</b>${skill.description ? ` <span class="muted">${escapeHtml(skill.description)}</span>` : ''}</div>`;
  const body = `<div class="muted">${escapeHtml(TEXT.skillsNote)}</div>`
    + groups.map(([plugin, list]) => contextGroupHtml(idPrefix + 'skills.g.' + plugin,
      plugin ? escapeHtml(plugin) : escapeHtml(TEXT.notFromPlugin), escapeHtml(groupNote(plugin, list)), approxTokensLabel(listingLength(list)),
      `<div class="cxlist">${list.map(skillLine(plugin)).join('')}</div>`)).join('');
  return contextCardHtml(idPrefix + 'skills', 'sys', cardHeader({ icon: `${iconSvg('skills')} `, title: escapeHtml(TEXT.skills), note, size: approxTokensLabel(listingLength(skills)) }), body);
}

// subagent types: one section each, its description inside
function subagentTypesCardHtml(agents, idPrefix) {
  const agentCard = (agent, index) => contextCardHtml(idPrefix + 'agents.' + index, 'tdef',
    `<b class="mono">${escapeHtml(agent.name)}</b> <span class="muted">${escapeHtml(shorten(agent.description, 100))}</span><span class="grow"></span><span class="sz">${approxTokensLabel(listingLength([agent]))}</span>`,
    agent.description ? preText(agent.description) : `<div class="muted">${escapeHtml(TEXT.noDescription)}</div>`);
  return contextCardHtml(idPrefix + 'agents', 'sys',
    cardHeader({ icon: `${iconSvg('agents')} `, title: escapeHtml(TEXT.subagentTypes), note: agents.length, size: approxTokensLabel(listingLength(agents)) }),
    agents.map(agentCard).join(''));
}

function mcpInstructionsCardHtml(servers, idPrefix) {
  const serverCard = (server, index) => contextCardHtml(idPrefix + 'mcp.' + index, 'tdef',
    `<b class="mono">${escapeHtml(server.name)}</b><span class="grow"></span><span class="sz">${approxTokensLabel(textLength(server.description))}</span>`, preText(server.description));
  return contextCardHtml(idPrefix + 'mcp', 'sys',
    cardHeader({ icon: `${iconSvg('other')} `, title: escapeHtml(TEXT.mcpInstructions), note: servers.length, size: approxTokensLabel(sumLengths(servers, server => textLength(server.description))) }),
    servers.map(serverCard).join(''));
}

// deferred tool names by MCP server (built-in first); a server that failed to connect shows its error
function deferredToolGroupsHtml(prompt, deferred, idPrefix) {
  const groups = groupEntries(deferred.tools, mcpServerOf, tool => textLength(tool.name));
  for (const failed of deferred.failedMcp) if (!groups.some(([server]) => server === failed.name)) groups.push([failed.name, []]);
  const errorByServer = new Map(deferred.failedMcp.map(failed => [failed.name, failed.error]));
  return groups.map(([server, tools]) => {
    const error = errorByServer.get(server), loaded = tools.filter(tool => isDeferredToolLoaded(prompt, tool)).length;
    const note = error != null ? `<span class="chip err">${escapeHtml(TEXT.failedConnect)}</span>`
      : escapeHtml(`${server ? 'MCP · ' : ''}${countOf(tools.length, 'tool')}${loaded ? ` · ${TEXT.loadedN(loaded)}` : ''}`);
    const chip = tool => {
      const isLoaded = isDeferredToolLoaded(prompt, tool);
      return `<span class="chip${isLoaded ? ' on' : ''}" title="${escapeHtml(tool.name)} · ${escapeHtml(isLoaded ? TEXT.loadedLc : TEXT.nameOnly)}">${escapeHtml(splitMcpToolName(tool.name)?.[1] || tool.name)}</span>`;
    };
    const body = (error ? `<div class="cu-err">${escapeHtml(error)}</div>` : '') + (tools.length ? `<div class="cu-chips">${tools.map(chip).join('')}</div>` : '');
    return contextGroupHtml(idPrefix + server, server ? escapeHtml(server) : escapeHtml(TEXT.builtIn), note,
      tools.length ? approxTokensLabel(deferredNamesLength({ tools })) : '', body, error != null);
  }).join('');
}

function deferredToolsCardHtml(prompt, idPrefix) {
  const deferred = prompt.deferred;
  const loaded = deferred.tools.filter(tool => isDeferredToolLoaded(prompt, tool)).length;
  const note = `${escapeHtml(TEXT.deferredSub(deferred.tools.length, loaded))}${deferred.failedMcp.length ? ` · ${escapeHtml(TEXT.failedX(countOf(deferred.failedMcp.length, 'mcpServer')))}` : ''}`;
  return contextCardHtml(idPrefix + 'deferred', 'sys',
    cardHeader({ icon: `${iconSvg('other')} `, title: escapeHtml(TEXT.deferredTools), note, size: approxTokensLabel(deferredNamesLength(deferred)) }),
    `<div class="muted">${escapeHtml(TEXT.deferredNote)}</div>` + deferredToolGroupsHtml(prompt, deferred, idPrefix + 'deferred.g.'));
}

const contextNoteHtml = text => `<div class="cxnote muted">${escapeHtml(text)}</div>`;

// everything above the conversation; `isMainAgent`: the session itself (notes on what is missing), not a subagent
function contextPreludeHtml(prompt, idPrefix, isMainAgent) {
  let html = '';
  const harness = EXTENSION_AGENTS.has(prompt.agent); // pi or omp: their own session file
  if (isMainAgent && prompt.agent === CODEX) html += contextNoteHtml(TEXT.codexContextNote);
  if (isMainAgent && harness) html += contextNoteHtml(TEXT.harnessContextNote(agentName(prompt.agent)));
  const measured = isMainAgent && prompt.measured;
  if (measured) html += contextNoteHtml(TEXT.measuredNote(formatCompactNumber(measured.firstCtx), measured.cpt ? localizeDecimal(measured.cpt.toFixed(1)) : null));
  if (prompt.system != null) html += systemPromptCardHtml(prompt, idPrefix) + toolDefinitionsCardHtml(prompt, idPrefix);
  else if (isMainAgent && harness) {
    html += contextNoteHtml(TEXT.harnessNoSystem(agentName(prompt.agent)));
    if (prompt.tools?.length) html += toolDefinitionsCardHtml(prompt, idPrefix);
  } else if (isMainAgent) html += contextNoteHtml(TEXT.noSystem);
  const instructions = prompt.instructions || [];
  if (instructions.length) html += instructionsCardHtml(instructions, idPrefix);
  else if (isMainAgent && !harness) html += contextNoteHtml(TEXT.noInstructions);
  if (prompt.skills?.length) html += skillsCardHtml(prompt.skills, idPrefix);
  if (prompt.agents?.length) html += subagentTypesCardHtml(prompt.agents, idPrefix);
  if (prompt.mcp?.length) html += mcpInstructionsCardHtml(prompt.mcp, idPrefix);
  if (prompt.deferred) html += deferredToolsCardHtml(prompt, idPrefix);
  return html;
}
