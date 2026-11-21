// What the model is told before the conversation: the system prompt and tool definitions (when this Claude Code
// version records the request shape in the transcript), the instruction files, and the lists of what it can use.
'use strict';
const { clipText } = require('./transcript-rows');

// "- name: description" lines (skill and agent listings) → name → description; a line not starting "- " continues the
// one before. Split at the first ": ", since plugin skill names hold a colon ("plugin:skill").
function readListingLines(lines, descriptionByName) {
  let lastName = null;
  for (const line of lines) {
    const entry = /^- (.+?): ([\s\S]*)$/.exec(line);
    if (entry) {
      lastName = entry[1];
      descriptionByName.set(lastName, entry[2]);
    } else if (/^- /.test(line)) {
      lastName = line.slice(2).trim();
      descriptionByName.set(lastName, '');
    } else if (lastName != null && line.trim()) {
      descriptionByName.set(lastName, descriptionByName.get(lastName) + '\n' + line);
    }
  }
}

const addMissing = (map, names, value) => { for (const name of names) if (!map.has(name)) map.set(name, value); };
const deleteAll = (map, names) => { for (const name of names || []) map.delete(name); };

// What the model knows it can use, beyond the tool definitions, as attachments that set or change a list:
// skill_listing (skills by name and description; a skill's SKILL.md arrives only when it is invoked),
// agent_listing_delta (subagent types), deferred_tools_delta (tools known by name only, loaded through ToolSearch;
// also which MCP servers failed to connect) and mcp_instructions_delta (each MCP server's own instructions).
// An initial listing replaces the list; a delta adds and removes.
function readListings(rows) {
  const skills = new Map(), agents = new Map(), deferredTools = new Map(), mcpInstructions = new Map();
  let failedMcpServers = null;

  for (const row of rows) {
    const attachment = row.attachment;
    if (!attachment) continue;
    switch (attachment.type) {
      case 'mcp_instructions_delta':
        deleteAll(mcpInstructions, attachment.removedNames);
        (attachment.addedNames || []).forEach((name, index) => mcpInstructions.set(name, String(attachment.addedBlocks?.[index] ?? '')));
        break;
      case 'skill_listing':
        if (attachment.isInitial !== false) skills.clear();
        if (typeof attachment.content === 'string') readListingLines(attachment.content.split('\n'), skills);
        addMissing(skills, Array.isArray(attachment.names) ? attachment.names : [], '');
        break;
      case 'agent_listing_delta':
        if (attachment.isInitial) agents.clear();
        deleteAll(agents, attachment.removedTypes);
        if (Array.isArray(attachment.addedLines)) readListingLines(attachment.addedLines, agents);
        addMissing(agents, attachment.addedTypes || [], '');
        break;
      case 'deferred_tools_delta':
        deleteAll(deferredTools, attachment.removedNames);
        addMissing(deferredTools, [...(attachment.addedNames || []), ...(attachment.readdedNames || [])], false);
        for (const name of attachment.surfacedNames || []) deferredTools.set(name, true); // loaded through ToolSearch
        if (Array.isArray(attachment.failedMcpServers)) failedMcpServers = attachment.failedMcpServers;
        break;
    }
  }

  const asList = map => [...map].map(([name, description]) => ({ name, description: clipText(description) }));
  const hasDeferred = deferredTools.size || failedMcpServers?.length;
  return {
    skills: skills.size ? asList(skills) : null,
    agents: agents.size ? asList(agents) : null,
    mcp: mcpInstructions.size ? asList(mcpInstructions) : null,
    deferred: hasDeferred ? {
      tools: [...deferredTools].map(([name, loaded]) => ({ name, loaded })),
      failedMcp: (failedMcpServers || []).map(server => ({
        name: String(server?.name || '?'),
        error: clipText(String(server?.error || server?.errorCode || '')),
      })),
    } : null,
  };
}

// the instruction files (CLAUDE.md, AGENTS.md, rules, auto-memory), newest copy of each
function readInstructionFiles(rows) {
  const files = new Map();
  for (const row of rows) {
    if (row.attachment?.type !== 'instructions' || !Array.isArray(row.attachment.files)) continue;
    for (const file of row.attachment.files) {
      if (file?.path) files.set(file.path, { path: file.path, type: file.type || null, content: clipText(String(file.content ?? '')) });
    }
  }
  return [...files.values()];
}

// the latest request shape the transcript recorded (system prompt and tool definitions)
function latestRequestShape(rows) {
  let shape = null;
  for (const row of rows) if (row.type === 'api-request-shape' && row.shape) shape = row.shape;
  return shape;
}

// the first one, which matches the first model step it is measured against (later requests carry more tools)
const firstRequestShape = rows => rows.find(row => row.type === 'api-request-shape' && row.shape)?.shape || null;

function systemPromptOf(rows) {
  const shape = latestRequestShape(rows);
  return {
    system: shape && Array.isArray(shape.system) ? clipText(shape.system.map(block => block?.text || '').join('\n\n')) : null,
    tools: shape && Array.isArray(shape.tools)
      ? shape.tools.map(tool => ({ name: tool.name || tool.type || '?', description: clipText(String(tool.description || '')), schema: tool.input_schema || null }))
      : null,
    instructions: readInstructionFiles(rows),
    ...readListings(rows),
  };
}

module.exports = { systemPromptOf, firstRequestShape, readListingLines };
