// Reduces the HTML that glowfic stores for a reply to a small allow-listed
// subset: enough structure to read in a browser, nothing that carries styling,
// scripting, or the site's own layout.

const INLINE = new Map([
  ['EM', 'em'],
  ['I', 'em'],
  ['STRONG', 'strong'],
  ['B', 'strong'],
  ['S', 's'],
  ['STRIKE', 's'],
  ['DEL', 's'],
  ['U', 'u'],
  ['INS', 'u'],
  ['CODE', 'code'],
  ['SUB', 'sub'],
  ['SUP', 'sup'],
  ['SMALL', 'small'],
  ['MARK', 'mark'],
]);

const BLOCK = new Map([
  ['P', 'p'],
  ['BLOCKQUOTE', 'blockquote'],
  ['UL', 'ul'],
  ['OL', 'ol'],
  ['LI', 'li'],
  ['PRE', 'pre'],
  ['TABLE', 'table'],
  ['THEAD', 'thead'],
  ['TBODY', 'tbody'],
  ['TR', 'tr'],
  ['TH', 'th'],
  ['TD', 'td'],
]);

const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const DROPPED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
const VOID_MARKUP = /<(?:img|hr|br)\b/;

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** Turns a reply's stored HTML into a clean fragment, one block per line. */
export function htmlToCleanHtml(html, options = {}) {
  const opts = { links: true, images: false, ...options };
  const body = new DOMParser().parseFromString(String(html ?? ''), 'text/html').body;
  return tidy(renderChildren(body, opts));
}

/**
 * Blocks are emitted with newlines around them, and the whitespace text nodes
 * the editor leaves between them survive as blank lines. Both are dropped here
 * so blocks sit one per line, except inside pre, where whitespace is content.
 */
function tidy(html) {
  const lines = [];
  let inPre = false;

  for (const line of html.split('\n')) {
    if (inPre) {
      lines.push(line);
      inPre = !line.includes('</pre>');
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) continue;
    lines.push(trimmed);
    inPre = trimmed.includes('<pre>') && !trimmed.includes('</pre>');
  }
  return lines.join('\n');
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderChildren(node, opts) {
  let out = '';
  for (const child of node.childNodes) out += renderNode(child, opts);
  return out;
}

function renderNode(node, opts) {
  if (node.nodeType === TEXT_NODE) {
    return escapeHtml(node.nodeValue.replace(/\u00a0/g, ' ').replace(/\s+/g, ' '));
  }
  if (node.nodeType !== ELEMENT_NODE) return '';

  const tag = node.tagName;
  if (DROPPED.has(tag)) return '';
  if (tag === 'BR') return '<br>';
  if (tag === 'HR') return '\n<hr>\n';
  if (tag === 'IMG') return renderImage(node, opts);
  if (tag === 'A') return renderLink(node, opts);
  if (tag === 'PRE') return `\n<pre>${escapeHtml(node.textContent.trim())}</pre>\n`;

  const inline = INLINE.get(tag);
  if (inline) {
    const inner = renderChildren(node, opts);
    return hasContent(inner) ? `<${inline}>${inner}</${inline}>` : inner;
  }

  // A heading inside a reply would compete with the per-entry headings that
  // structure the document, so it keeps its weight but not its level.
  if (HEADINGS.has(tag)) return block('p', `<strong>${renderChildren(node, opts)}</strong>`);

  const blockTag = BLOCK.get(tag);
  if (blockTag) return block(blockTag, renderChildren(node, opts));

  if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') return renderContainer(node, opts);

  // SPAN, FONT, and anything unrecognized contribute their children only.
  return renderChildren(node, opts);
}

/**
 * A div holding blocks is unwrapped, since nesting them inside a paragraph
 * would be invalid; a div holding only text becomes that paragraph.
 */
function renderContainer(node, opts) {
  const inner = renderChildren(node, opts);
  const holdsBlocks = [...node.children].some(
    (child) => BLOCK.has(child.tagName) || HEADINGS.has(child.tagName)
  );
  return holdsBlocks ? inner : block('p', inner);
}

function block(tag, inner) {
  const trimmed = inner.trim();
  if (!hasContent(trimmed)) return '';
  return `\n<${tag}>${trimmed}</${tag}>\n`;
}

function hasContent(html) {
  return VOID_MARKUP.test(html) || html.replace(/<[^>]*>/g, '').trim().length > 0;
}

function renderImage(node, opts) {
  if (!opts.images) return '';
  const src = node.getAttribute('src');
  if (!src) return '';
  const alt = escapeHtml(node.getAttribute('alt') || '');
  return `<img src="${escapeHtml(src)}" alt="${alt}">`;
}

function renderLink(node, opts) {
  const inner = renderChildren(node, opts);
  const href = node.getAttribute('href');
  if (!opts.links || !href || !hasContent(inner)) return inner;
  return `<a href="${escapeHtml(absolute(href))}">${inner}</a>`;
}

function absolute(href) {
  return href.startsWith('/') ? `https://glowfic.com${href}` : href;
}
