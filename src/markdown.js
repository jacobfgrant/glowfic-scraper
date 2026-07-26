// Converts the HTML that glowfic stores for a reply into compact markdown.
// The goal is token efficiency for pasting into an LLM chat, not fidelity to
// the site's rendering, so styling-only markup is discarded.
//
// Reply text is written by strangers and lands in a document whose structure
// carries meaning — `## Character (author)` is how the transcript says who
// spoke. So anything in reply text that could pass for that structure is
// escaped: a reply must never be able to mint a heading and put words in
// someone else's mouth.

import { DROPPED, ELEMENT_NODE, HEADINGS, TEXT_NODE, normalizeSpace, safeUrl } from './htmlnodes.js';

const EMPHASIS = new Map([
  ['EM', '*'],
  ['I', '*'],
  ['STRONG', '**'],
  ['B', '**'],
  ['S', '~~'],
  ['STRIKE', '~~'],
  ['DEL', '~~'],
  ['U', '_'],
  ['INS', '_'],
  ['CODE', '`'],
]);

const BLOCKS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'ADDRESS', 'FIGURE', 'FIGCAPTION']);

// A line of only dashes or equals signs turns the line above it into a heading,
// which is the other way to forge a speaker label. A run of backticks or tildes
// opens a code fence that would swallow every entry after it.
const SETEXT_RULE = /^(-+|=+)\s*$/;
const CODE_FENCE = /^(`{3,}|~{3,})/;
// Four spaces already means "code block", so those lines are left exactly as
// they are — they cannot introduce structure and their whitespace is content.
const INDENTED_CODE = /^ {4}/;

/** Turns a reply's stored HTML into markdown. */
export function htmlToMarkdown(html, options = {}) {
  const opts = { links: true, images: false, ...options };
  const body = parseBody(html ?? '');
  return tidy(renderChildren(body, opts, { listDepth: 0 }));
}

function parseBody(html) {
  return new DOMParser().parseFromString(String(html), 'text/html').body;
}

function renderChildren(node, opts, ctx) {
  let out = '';
  for (const child of node.childNodes) out += renderNode(child, opts, ctx);
  return out;
}

function renderNode(node, opts, ctx) {
  if (node.nodeType === TEXT_NODE) return escapeText(normalizeSpace(node.nodeValue));
  if (node.nodeType !== ELEMENT_NODE) return '';

  const tag = node.tagName;
  if (DROPPED.has(tag)) return '';

  if (tag === 'BR') return '\n';
  // `***` rather than `---`, so a line of dashes is always something a reply
  // wrote and can be escaped without destroying our own rules.
  if (tag === 'HR') return '\n\n***\n\n';
  if (tag === 'IMG') return renderImage(node, opts);
  if (tag === 'A') return renderLink(node, opts, ctx);
  if (tag === 'PRE') return renderPre(node);
  if (tag === 'BLOCKQUOTE') return renderBlockquote(node, opts, ctx);
  if (tag === 'UL' || tag === 'OL') return renderList(node, opts, ctx);
  if (tag === 'TABLE') return renderTable(node, opts, ctx);

  const marker = EMPHASIS.get(tag);
  if (marker) return wrap(renderChildren(node, opts, ctx), marker);

  // Headings inside a reply are downgraded to bold so they can't collide with
  // the `## Speaker` headers that structure the exported transcript.
  if (HEADINGS.has(tag)) {
    return `\n\n${wrap(renderChildren(node, opts, ctx), '**')}\n\n`;
  }

  if (BLOCKS.has(tag)) return `\n\n${renderChildren(node, opts, ctx)}\n\n`;

  // SPAN, FONT, and anything unrecognized are treated as transparent.
  return renderChildren(node, opts, ctx);
}

/**
 * Escapes what would otherwise be markdown syntax coming from reply text.
 *
 * Backslash goes first so it cannot cancel the escapes that follow. Brackets
 * stop a reply from closing our link syntax and opening its own; `<` stops raw
 * HTML from reaching a renderer that would run it. Emphasis characters are
 * deliberately left alone: they cannot forge structure, and escaping them makes
 * ordinary prose unreadable.
 */
function escapeText(text) {
  return text.replace(/([\\[\]<])/g, '\\$1');
}

// Indented rather than fenced, so nothing this converter emits can be mistaken
// for a fence a reply opened.
function renderPre(node) {
  const body = node.textContent.replace(/\s+$/, '');
  if (!body.trim()) return '';
  const lines = body.split('\n').map((line) => `    ${line}`);
  return `\n\n${lines.join('\n')}\n\n`;
}

function renderImage(node, opts) {
  if (!opts.images) return '';
  const src = safeUrl(node.getAttribute('src'));
  const alt = escapeText((node.getAttribute('alt') || '').trim());
  return src ? `![${alt}](${src})` : '';
}

function renderLink(node, opts, ctx) {
  const inner = renderChildren(node, opts, ctx);
  const href = safeUrl(node.getAttribute('href'));
  // An unsafe scheme loses the link but keeps the words.
  if (!opts.links || !href || !inner.trim()) return inner;
  return `[${inner.trim()}](${href})`;
}

function renderBlockquote(node, opts, ctx) {
  const inner = tidy(renderChildren(node, opts, ctx));
  if (!inner) return '';
  const quoted = inner.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
  return `\n\n${quoted}\n\n`;
}

function renderList(node, opts, ctx) {
  const ordered = node.tagName === 'OL';
  const items = [...node.children].filter((child) => child.tagName === 'LI');
  const pad = '  '.repeat(ctx.listDepth);
  const lines = items.map((item, index) => {
    const marker = ordered ? `${index + 1}. ` : '- ';
    const inner = tidy(renderChildren(item, opts, { ...ctx, listDepth: ctx.listDepth + 1 }));
    const [first, ...rest] = inner.split('\n');
    const continuation = rest.map((line) => `${pad}${' '.repeat(marker.length)}${line}`);
    return [`${pad}${marker}${first}`, ...continuation].join('\n');
  });
  return `\n\n${lines.join('\n')}\n\n`;
}

function renderTable(node, opts, ctx) {
  const rows = [...node.querySelectorAll('tr')].map((row) =>
    [...row.children]
      .map((cell) => renderChildren(cell, opts, ctx).replace(/\s+/g, ' ').trim())
      .join(' | ')
  );
  if (!rows.length) return '';
  const [header, ...rest] = rows;
  const divider = header.split(' | ').map(() => '---').join(' | ');
  return `\n\n${[header, divider, ...rest].join('\n')}\n\n`;
}

/**
 * Applies an emphasis marker without trapping whitespace inside it, since
 * markdown ignores `* foo *` but honours ` *foo* `.
 */
function wrap(inner, marker) {
  const trimmed = inner.trim();
  if (!trimmed) return inner;
  const leading = inner.slice(0, inner.length - inner.trimStart().length);
  const trailing = inner.slice(inner.trimEnd().length);
  return `${leading}${marker}${trimmed}${marker}${trailing}`;
}

function tidy(text) {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map(tidyLine)
    .join('\n')
    .trim();
}

function tidyLine(line) {
  if (INDENTED_CODE.test(line)) return line;

  const indent = line.slice(0, line.length - line.trimStart().length);
  let rest = line
    .trimStart()
    // Dropping an inline element (an icon image, say) can leave a double space.
    .replace(/ {2,}/g, ' ');

  if (rest.startsWith('#') || SETEXT_RULE.test(rest) || CODE_FENCE.test(rest)) {
    rest = `\\${rest}`;
  }
  return `${indent}${rest}`;
}
