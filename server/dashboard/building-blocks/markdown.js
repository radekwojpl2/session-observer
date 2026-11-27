'use strict';
// Session Observer dashboard — Markdown as the agents write it, made readable: headings, bullet and numbered lists,
// fenced code, tables, quotes, `code`, **bold**, *italic*, and [links](…) shown as their text (the page opens
// nothing). Everything is escaped first; only these tags are added. Its names start with markdown or MD_: every dashboard
// script shares one global scope. Its names start with markdown / MD_: every
// dashboard script shares one global scope.

function inlineMarkdownHtml(text) {
  return escapeHtml(text)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?![*\w])/g, '$1<i>$2</i>')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '<u title="$2">$1</u>');
}

const MD_FENCE = /^\s*(```|~~~)/;
const MD_HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const MD_LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const MD_QUOTE = /^\s*>\s?(.*)$/;
const MD_TABLE_ROW = /^\s*\|.*\|\s*$/;
const MD_TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/; // |---|:-:|
const MD_RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const startsMarkdownBlock = line => MD_FENCE.test(line) || MD_HEADING.test(line) || MD_LIST_ITEM.test(line) || MD_QUOTE.test(line) || MD_TABLE_ROW.test(line) || MD_RULE.test(line);

const markdownTableCells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());

function markdownTableHtml(rows) {
  const [head, ...body] = rows;
  const row = (cells, tag) => `<tr>${cells.map(cell => `<${tag}>${inlineMarkdownHtml(cell)}</${tag}>`).join('')}</tr>`;
  return `<table><thead>${row(head, 'th')}</thead><tbody>${body.map(cells => row(cells, 'td')).join('')}</tbody></table>`;
}

// a list's items, each with how deep it is (2 spaces a level), and the lines that carry it on
function markdownListHtml(lines, start) {
  const ordered = /\d/.test(lines[start].match(MD_LIST_ITEM)[2]);
  const items = [];
  let index = start;
  while (index < lines.length) {
    const item = lines[index].match(MD_LIST_ITEM);
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
    if (MD_FENCE.test(line)) {
      const code = [];
      for (index++; index < lines.length && !MD_FENCE.test(lines[index]); index++) code.push(lines[index]);
      index++; // the closing fence
      html.push(`<pre>${escapeHtml(code.join('\n'))}</pre>`);
    } else if (MD_HEADING.test(line)) {
      const [, hashes, text] = line.match(MD_HEADING);
      html.push(`<div class="md-h md-h${Math.min(hashes.length, 3)}">${inlineMarkdownHtml(text)}</div>`);
      index++;
    } else if (MD_TABLE_ROW.test(line)) {
      const rows = [];
      for (; index < lines.length && MD_TABLE_ROW.test(lines[index]); index++) if (!MD_TABLE_RULE.test(lines[index])) rows.push(markdownTableCells(lines[index]));
      html.push(markdownTableHtml(rows));
    } else if (MD_LIST_ITEM.test(line)) {
      const list = markdownListHtml(lines, index);
      html.push(list.html);
      index = list.next;
    } else if (MD_QUOTE.test(line)) {
      const quoted = [];
      for (; index < lines.length && MD_QUOTE.test(lines[index]); index++) quoted.push(lines[index].match(MD_QUOTE)[1]);
      html.push(`<blockquote>${markdownHtml(quoted.join('\n'))}</blockquote>`);
    } else if (MD_RULE.test(line)) {
      html.push('<hr>');
      index++;
    } else {
      const paragraph = [];
      for (; index < lines.length && lines[index].trim() && (!paragraph.length || !startsMarkdownBlock(lines[index])); index++) paragraph.push(lines[index]);
      html.push(`<p>${paragraph.map(inlineMarkdownHtml).join('<br>')}</p>`);
    }
  }
  return html.join('');
}
