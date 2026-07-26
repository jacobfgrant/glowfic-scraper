// Converts the HTML that glowfic stores for a reply into compact markdown.
// The goal is token efficiency for pasting into an LLM chat, not fidelity to
// the site's rendering, so styling-only markup is discarded.

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

const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const BLOCKS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'ADDRESS', 'FIGURE', 'FIGCAPTION']);
const DROPPED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

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
  if (node.nodeType === TEXT_NODE) return normalizeText(node.nodeValue);
  if (node.nodeType !== ELEMENT_NODE) return '';

  const tag = node.tagName;
  if (DROPPED.has(tag)) return '';

  if (tag === 'BR') return '\n';
  if (tag === 'HR') return '\n\n---\n\n';
  if (tag === 'IMG') return renderImage(node, opts);
  if (tag === 'A') return renderLink(node, opts, ctx);
  if (tag === 'PRE') return `\n\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`;
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

function renderImage(node, opts) {
  if (!opts.images) return '';
  const src = node.getAttribute('src') || '';
  const alt = (node.getAttribute('alt') || '').trim();
  return src ? `![${alt}](${src})` : '';
}

function renderLink(node, opts, ctx) {
  const inner = renderChildren(node, opts, ctx);
  const href = node.getAttribute('href');
  if (!opts.links || !href || !inner.trim()) return inner;
  return `[${inner.trim()}](${absolute(href)})`;
}

function absolute(href) {
  return href.startsWith('/') ? `https://glowfic.com${href}` : href;
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

function normalizeText(value) {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
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
  let inCodeFence = false;
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('```')) {
        inCodeFence = !inCodeFence;
        return line;
      }
      return inCodeFence ? line : tidyLine(line);
    })
    .join('\n')
    .trim();
}

function tidyLine(line) {
  const indent = line.slice(0, line.length - line.trimStart().length);
  const rest = line
    .trimStart()
    // Dropping an inline element (an icon image, say) can leave a double space.
    .replace(/ {2,}/g, ' ')
    // Prose that happens to start with # would otherwise read as a heading and
    // break the speaker structure the transcript relies on.
    .replace(/^#/, '\\#');
  return `${indent}${rest}`;
}
