'use strict';
// Session Observer dashboard — Context view, Copy: everything shown, as Markdown (always in English).
const markdownFence = (text, language = '') => '```' + language + '\n' + String(text ?? '').replace(/```/g, '`​``') + '\n```\n';

function itemMarkdown(item, depth) {
  const heading = '#'.repeat(Math.min(6, 3 + depth));
  switch (item.kind) {
    case 'user': return `${heading} You\n\n${item.text}\n`;
    case 'text': return `${heading} ${agentShortName(contextView.data?.agent)}\n\n${item.text}\n`;
    case 'thinking': return `${heading} Thinking\n\n${markdownFence(item.text)}`;
    case 'summary': return `${heading} Compaction summary\n\n${item.text}\n`;
    case 'compact': return `---\n\n*Compacted${item.preTokens ? ` at ${item.preTokens} tokens` : ''}*\n`;
    case 'meta': return `${heading} Injected\n\n${markdownFence(item.text)}`;
    case 'attachment':
      if (item.role === 'meta' && !showBookkeeping) return '';
      return `${heading} Attachment: ${item.label}${item.role === 'meta' ? ' (not sent)' : ''}\n\n${markdownFence(item.text)}`;
    case 'call': return `${heading} Tool: ${item.name}\n\n${markdownFence(JSON.stringify(item.input, null, 2), 'json')}${item.sub ? itemsMarkdown(item.sub.items, depth + 1) : ''}`;
    case 'result': return `${heading} ${item.error ? 'Failed' : 'Result'}: ${item.call.name}\n\n${markdownFence(item.text)}`;
    case 'orphan': return `${heading} Tool result\n\n${markdownFence(item.text)}`;
    default: return '';
  }
}

const itemsMarkdown = (items, depth = 0) => items.map(item => itemMarkdown(item, depth)).filter(Boolean).join('\n');
const nameAndDescriptionList = entries => entries.map(entry => `- **${entry.name}**: ${entry.description}`).join('\n');

function contextMarkdown() {
  const data = contextView.data;
  if (!data) return '';
  const { items } = itemsInRange(data);
  const sections = [];
  if (data.system != null) sections.push(`## System prompt\n\n${markdownFence(data.system)}\n## Tools\n\n${data.tools.map(tool => `- **${tool.name}**`).join('\n')}\n\n`);
  if ((data.instructions || []).length) sections.push(`## Instructions\n\n${data.instructions.map(file => `### ${file.path}\n\n${markdownFence(file.content)}`).join('\n')}\n`);
  if (data.skills?.length) sections.push(`## Skills\n\n${nameAndDescriptionList(data.skills)}\n\n`);
  if (data.agents?.length) sections.push(`## Subagent types\n\n${nameAndDescriptionList(data.agents)}\n\n`);
  if (data.deferred?.tools.length) sections.push(`## Deferred tools\n\n${data.deferred.tools.map(tool => `- ${tool.name}${isDeferredToolLoaded(data, tool) ? ' (loaded)' : ''}`).join('\n')}\n\n`);
  sections.push(`## Conversation\n\n${itemsMarkdown(items)}`);
  return sections.join('');
}
