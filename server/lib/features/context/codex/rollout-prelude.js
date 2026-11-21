// What a Codex model is given before the conversation, from Codex's session file (its "rollout"): the system prompt,
// the tool definitions, the instructions, and the lists of skills and deferred tools.
//
// Codex labels each part of a message with what it is (content_item_kinds: "model.base_instructions",
// "host_skills.instructions", …). The file is Codex's own record, not a stable interface: anything this reader does
// not recognize is left out, never an error.
'use strict';
const { clipText } = require('../transcript-rows');
const { readListingLines } = require('../system-prompt');

const KIND = {
  system: 'model.base_instructions',
  skills: 'host_skills.instructions',
  deferredTools: 'tools.deferred_namespaces',
  environment: 'environments.environment_context',
  prompt: 'user.text',
};
// parts sent along the way (the time, the environment), not instructions
const isSentAlongTheWay = kind => kind === KIND.environment || kind.startsWith('additional_content.');
// AGENTS.md reaches the model as a user message: "# AGENTS.md instructions for <folder>"
const AGENTS_FILE = /^# (AGENTS(?:\.override)?\.md) instructions for (.+)$/m;

const payloadOf = row => (row && typeof row.payload === 'object' && row.payload) || {};
const isMessage = row => row.type === 'response_item' && payloadOf(row).type === 'message';

// a content part as text: text as it is, an image as a marker, anything else as JSON
function partText(part) {
  if (typeof part === 'string') return part;
  if (typeof part?.text === 'string') return part.text;
  if (/image/.test(part?.type || '')) return '[image]';
  return JSON.stringify(part);
}

// every part of a message with what it is: [{ kind, text }]. A user part with no label is the prompt; an
// assistant's are its reply.
function messageParts(payload) {
  const parts = Array.isArray(payload.content) ? payload.content : [];
  const kinds = payload.internal_chat_message_metadata_passthrough?.content_item_kinds || [];
  return parts.map((part, index) => {
    const text = partText(part);
    let kind = typeof kinds[index] === 'string' && kinds[index] !== 'unknown' ? kinds[index] : '';
    if (payload.role !== 'assistant' && AGENTS_FILE.test(text)) kind = 'agents_md';
    if (!kind) kind = payload.role === 'user' ? KIND.prompt : payload.role || '?';
    return { kind, text };
  });
}

// what a part is for the view: 'system', 'skills', 'deferred', 'instructions' (pinned on top), 'sent' (an
// attachment along the way), 'prompt', or 'reply'
function partRole(role, kind) {
  if (role === 'assistant') return 'reply';
  if (kind === KIND.prompt) return 'prompt';
  if (kind === KIND.system) return 'system';
  if (kind === KIND.skills) return 'skills';
  if (kind === KIND.deferredTools) return 'deferred';
  if (kind === 'agents_md' || (role === 'developer' && !isSentAlongTheWay(kind))) return 'instructions';
  return 'sent';
}

// "permissions.instructions" → "permissions instructions", for a card title
const kindLabel = kind => kind.replace(/[._]/g, ' ');

// Tools come in namespaces. MCP tools keep the "mcp__server__tool" form the view groups by server; the default
// "functions" namespace is plain names; any other is "namespace.tool".
function toolName(namespace, name) {
  if (!namespace || namespace === 'functions') return name;
  return namespace.startsWith('mcp__') ? `${namespace}__${name}` : `${namespace}.${name}`;
}

function flattenTools(tools, namespace = '') {
  const list = [];
  for (const tool of Array.isArray(tools) ? tools : []) {
    if (tool?.type === 'namespace' && Array.isArray(tool.tools)) {
      list.push(...flattenTools(tool.tools, tool.name));
      continue;
    }
    if (!tool?.name) continue;
    list.push({
      name: toolName(namespace, tool.name),
      description: clipText(String(tool.description || '')),
      schema: tool.parameters || tool.format || null, // a function's JSON schema, or a custom tool's grammar
    });
  }
  return list;
}

// the "- name: description" lines under a heading, up to the next heading
function listingUnder(text, heading) {
  const start = text.indexOf(heading);
  if (start < 0) return [];
  const lines = [];
  for (const line of text.slice(start + heading.length).split('\n')) {
    if (/^#{1,6} /.test(line) || /^<\//.test(line)) break;
    lines.push(line);
  }
  return lines;
}

// The first skills message lists them all ("### Available skills"); a later one only what changed ("### Added or
// updated skills:", "### Removed skills:").
function readSkills(text, skills) {
  if (text.includes('### Available skills')) {
    skills.clear();
    readListingLines(listingUnder(text, '### Available skills'), skills);
  }
  readListingLines(listingUnder(text, '### Added or updated skills:'), skills);
  const removed = new Map();
  readListingLines(listingUnder(text, '### Removed skills:'), removed);
  for (const name of removed.keys()) skills.delete(name);
}

const skillList = skills => [...skills].map(([name, description]) => ({
  name,
  description: clipText(description.replace(/\s*\(file: [^)]*\)\s*$/, '')), // where the SKILL.md is
}));

function deferredToolsOf(text) {
  const tools = new Map();
  readListingLines(listingUnder(text, 'Deferred tool namespaces:'), tools);
  return [...tools.keys()].map(name => ({ name, loaded: false }));
}

// The prelude: the latest copy of each part (Codex sends a part again when it changes).
function codexPreludeOf(rows) {
  let system = null, tools = null, deferred = null;
  const skills = new Map();
  const instructions = new Map();
  for (const row of rows) {
    const payload = payloadOf(row);
    if (row.type === 'session_meta' && typeof payload.base_instructions?.text === 'string') system = payload.base_instructions.text;
    if (row.type === 'response_item' && payload.type === 'additional_tools') tools = flattenTools(payload.tools);
    if (!isMessage(row)) continue;
    for (const { kind, text } of messageParts(payload)) {
      switch (partRole(payload.role, kind)) {
        case 'system': system = text; break;
        case 'skills': readSkills(text, skills); break;
        case 'deferred': deferred = deferredToolsOf(text); break;
        case 'instructions': {
          const agentsFile = AGENTS_FILE.exec(text);
          const folder = agentsFile?.[2].trim();
          const separator = folder?.includes('\\') ? '\\' : '/'; // the folder's own: a Windows path keeps backslashes
          const path = agentsFile ? `${folder.replace(/[\\/]$/, '')}${separator}${agentsFile[1]}` : kindLabel(kind);
          instructions.set(path, { path, type: agentsFile ? 'Project' : 'Codex', content: clipText(text) });
          break;
        }
      }
    }
  }
  return {
    system: system != null ? clipText(system) : null,
    tools: system != null ? tools || [] : tools,
    instructions: [...instructions.values()],
    skills: skills.size ? skillList(skills) : null,
    agents: null,
    mcp: null,
    deferred: deferred?.length ? { tools: deferred, failedMcp: [] } : null,
  };
}

module.exports = { codexPreludeOf, messageParts, partRole, kindLabel, payloadOf, isMessage };
