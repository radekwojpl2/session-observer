'use strict';
// Session Observer dashboard — Markdown as the agents write it, made readable: headings, bullet and numbered lists,
// fenced code, tables, quotes, `code`, **bold**, *italic*, and [links](…) shown as their text (the page opens
// nothing). Everything is escaped first; only these tags are added.

function inlineMarkdownHtml(text) {
  return escapeHtml(text)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?![*\w])/g, '$1<i>$2</i>')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '<u title="$2">$1</u>');
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/; // |---|:-:|
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const startsBlock = line => FENCE.test(line) || HEADING.test(line) || LIST_ITEM.test(line) || QUOTE.test(line) || TABLE_ROW.test(line) || RULE.test(line);

const tableCells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());

function tableHtml(rows) {
  const [head, ...body] = rows;
  const row = (cells, tag) => `<tr>${cells.map(cell => `<${tag}>${inlineMarkdownHtml(cell)}</${tag}>`).join('')}</tr>`;
  return `<table><thead>${row(head, 'th')}</thead><tbody>${body.map(cells => row(cells, 'td')).join('')}</tbody></table>`;
}

// a list's items, each with how deep it is (2 spaces a level), and the lines that carry it on
function listHtml(lines, start) {
  const ordered = /\d/.test(lines[start].match(LIST_ITEM)[2]);
  const items = [];
  let index = start;
  while (index < lines.length) {
    const item = lines[index].match(LIST_ITEM);
    if (item) {
      items.push({ depth: Math.floor(item[1].replace(/\t/g, '  ').length / 2), text: item[3] });
    } else if (/^\s{2,}\S/.test(lines[index]) && items.length) {
      items[items.length - 1].text += ' ' + lines[index].trim(); // a wrapped item
    } else break;
    index++;
  }
  const tag = ordered ? 'ol' : 'ul';
  const html = `<${tag}>${items.map(item => `<li${item.depth ? ` style="margin-left:${item.depth * 1.2}em"` : ''}>${inlineMarkdownHtml(item.text)}</li>`).join('')}</${tag}>`;
  return { html, next: index };
}

function markdownHtml(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    if (FENCE.test(line)) {
      const code = [];
      for (index++; index < lines.length && !FENCE.test(lines[index]); index++) code.push(lines[index]);
      index++; // the closing fence
      html.push(`<pre>${escapeHtml(code.join('\n'))}</pre>`);
    } else if (HEADING.test(line)) {
      const [, hashes, text] = line.match(HEADING);
      html.push(`<div class="md-h md-h${Math.min(hashes.length, 3)}">${inlineMarkdownHtml(text)}</div>`);
      index++;
    } else if (TABLE_ROW.test(line)) {
      const rows = [];
      for (; index < lines.length && TABLE_ROW.test(lines[index]); index++) if (!TABLE_RULE.test(lines[index])) rows.push(tableCells(lines[index]));
      html.push(tableHtml(rows));
    } else if (LIST_ITEM.test(line)) {
      const list = listHtml(lines, index);
      html.push(list.html);
      index = list.next;
    } else if (QUOTE.test(line)) {
      const quoted = [];
      for (; index < lines.length && QUOTE.test(lines[index]); index++) quoted.push(lines[index].match(QUOTE)[1]);
      html.push(`<blockquote>${markdownHtml(quoted.join('\n'))}</blockquote>`);
    } else if (RULE.test(line)) {
      html.push('<hr>');
      index++;
    } else {
      const paragraph = [];
      for (; index < lines.length && lines[index].trim() && (!paragraph.length || !startsBlock(lines[index])); index++) paragraph.push(lines[index]);
      html.push(`<p>${paragraph.map(inlineMarkdownHtml).join('<br>')}</p>`);
    }
  }
  return html.join('');
}
