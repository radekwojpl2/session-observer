'use strict';
// Session Observer dashboard — how a tool call's input and result are shown, shaped per tool.
const WRITE_PREVIEW_MAX = 20000;
const READ_PREVIEW_MAX = 1500;

function diffHtml(before, after) {
  const linesOf = (text, className, marker) => String(text ?? '').split('\n').map(line => `<span class="${className}">${marker} ${escapeHtml(line)}</span>`).join('\n');
  return `<pre class="code diff">${linesOf(before, 'del', '-')}\n${linesOf(after, 'ins', '+')}</pre>`;
}

const shellCommandHtml = input =>
  (input.command ? `<pre class="code">${highlightShellCommand(input.command)}</pre>` : '') + (input.description ? `<div class="muted">${escapeHtml(input.description)}</div>` : '');

function parseJsonOrUndefined(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

// a file's new content: JSON laid out, code coloured
function writtenContentHtml(input) {
  if (input.content == null) return '';
  const language = codeLanguageOfFile(input.file_path);
  const json = language === 'json' ? parseJsonOrUndefined(input.content) : undefined;
  return `<pre class="code">${json !== undefined && json !== false ? jsonHtml(json) : highlightCode(String(input.content).slice(0, WRITE_PREVIEW_MAX), language)}</pre>`;
}

const questionsHtml = questions => (questions || []).map(question =>
  `<div class="q2"><b>${escapeHtml(question.question)}</b>${(question.options || []).map(option =>
    `<div class="opt">• ${escapeHtml(option.label)}${option.description ? ` <span class="muted">— ${escapeHtml(option.description)}</span>` : ''}</div>`).join('')}</div>`).join('');

const subagentCallFieldsHtml = input => fieldTableHtml({ [TEXT.fields.description]: input.description, [TEXT.fields.type]: input.subagent_type, [TEXT.fields.model]: input.model }, NO_FIELDS_SKIPPED);

// a tool's input, shaped per tool
function toolInputHtml(tool, input) {
  input = input || {};
  const fields = TEXT.fields;
  if (isPatchTool(tool)) return fieldTableHtml({ [fields.file]: patchedFiles(input).join('\n') }, NO_FIELDS_SKIPPED) + cardCodeHtml(patchTextOf(input));
  // PowerShell's input shows as a plain field table, as before
  if (COMMAND_TOOLS.has(tool) && tool !== 'PowerShell') return shellCommandHtml(input);
  switch (tool) {
    case 'Edit': return fieldTableHtml({ [fields.file]: input.file_path, [fields.replaceAll]: input.replace_all || null }, NO_FIELDS_SKIPPED) + diffHtml(input.old_string, input.new_string);
    case 'MultiEdit': return fieldTableHtml({ [fields.file]: input.file_path }, NO_FIELDS_SKIPPED) + (input.edits || []).map(edit => diffHtml(edit.old_string, edit.new_string)).join('');
    case 'Write': return fieldTableHtml({ [fields.file]: input.file_path }, NO_FIELDS_SKIPPED) + writtenContentHtml(input);
    case 'Agent': case 'Task': return subagentCallFieldsHtml(input) + cardSectionHtml(escapeHtml(TEXT.prompt), cardTextHtml(input.prompt));
    case 'AskUserQuestion': return questionsHtml(input.questions);
    default: return fieldTableHtml(input, NO_FIELDS_SKIPPED);
  }
}

function readResultHtml(response) {
  const file = response.file || {}, fields = TEXT.fields;
  const firstLine = file.startLine ?? 1;
  const lines = file.numLines != null ? TEXT.linesOf(firstLine, firstLine + file.numLines - 1, file.totalLines ?? '?') : null;
  const content = file.content && String(file.content).slice(0, READ_PREVIEW_MAX) + (String(file.content).length > READ_PREVIEW_MAX ? '\n…' : '');
  return fieldTableHtml({ [fields.file]: file.filePath, [fields.lines]: lines, [fields.type]: response.type }, NO_FIELDS_SKIPPED) + cardCodeHtml(content);
}

function subagentResultHtml(response) {
  const fields = TEXT.fields;
  const text = Array.isArray(response.content) ? response.content.map(block => block.text || '').join('\n') : response.result;
  return fieldTableHtml({ [fields.status]: response.status, [fields.agent]: response.agentId, [fields.model]: response.resolvedModel, [fields.async]: response.isAsync }, NO_FIELDS_SKIPPED) + cardTextHtml(text);
}

// a tool's result (its PostToolUse / PostToolUseFailure), shaped per tool
function toolOutputHtml(tool, resultEvent) {
  const data = resultEvent.data || {}, response = data.tool_response;
  const noOutput = `<div class="muted">${escapeHtml(TEXT.noOutput)}</div>`;
  if (resultEvent.event === 'PostToolUseFailure') {
    return outputBlockHtml(data.error, 'err') + (data.is_interrupt ? `<div class="muted">${escapeHtml(TEXT.interruptedByUser)}</div>` : '');
  }
  if (response == null) return noOutput;
  if (typeof response === 'string') return outputBlockHtml(response);
  switch (tool) {
    case 'Bash':
      return (response.stdout || response.stderr ? outputBlockHtml(response.stdout) + outputBlockHtml(response.stderr, 'err') : noOutput)
        + (response.interrupted ? `<div class="err">${escapeHtml(TEXT.interrupted)}</div>` : '');
    case 'Read': return readResultHtml(response);
    case 'Edit': case 'MultiEdit': case 'Write':
      return `<div>${escapeHtml(response.userModified ? TEXT.appliedChanged : TEXT.applied)} · <span class="muted">${escapeHtml(response.filePath || '')}</span></div>`;
    case 'Agent': case 'Task': return subagentResultHtml(response);
    case 'AskUserQuestion': return fieldTableHtml(response.answers, NO_FIELDS_SKIPPED) || `<div class="muted">${escapeHtml(TEXT.noAnswers)}</div>`;
    default: return fieldTableHtml(response, new Set(['originalFile', 'structuredPatch']));
  }
}
