// Assembles entries into a finished document. Both formats carry the same
// facts and the same per-entry structure; they differ only in how they write it.

import { htmlToMarkdown } from './markdown.js';
import { escapeHtml, htmlToCleanHtml } from './cleanhtml.js';

const DEFAULT_MAX_CHARS = 300_000;

/**
 * Character names, icon keywords, thread subjects and descriptions are all
 * chosen by the people being exported. A line break in any of them would let
 * one become a second `## Speaker` heading, so they are flattened to one line
 * before they go anywhere near the document structure.
 */
function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function speakerLabel({ name, username }) {
  const character = oneLine(name);
  const author = oneLine(username);
  if (character && author && character !== author) return `${character} (${author})`;
  return character || author || 'unknown';
}

/** The facts both formats put at the top of every file. */
export function documentFacts(post, { scope, part } = {}) {
  const authors = (post.authors ?? []).map((author) => author.username).join(' & ');
  const board = [...new Set([post.board?.name, post.section?.name].filter(Boolean))].join(' / ');
  return {
    title: oneLine(post.subject) || 'Glowfic thread',
    summary: oneLine([board, authors, `${post.num_replies} replies`].filter(Boolean).join(' · ')),
    url: `https://glowfic.com/posts/${post.id}`,
    description: oneLine(post.description) || null,
    notes: [scope, part].filter(Boolean).map(oneLine),
  };
}

const markdown = {
  id: 'markdown',
  label: 'Markdown (.md)',
  extension: 'md',
  mime: 'text/markdown',

  entry(entry, options) {
    const icon = options.icons !== false && entry.icon ? ` [${oneLine(entry.icon)}]` : '';
    return `## ${speakerLabel(entry)}${icon}\n${htmlToMarkdown(entry.html, options)}`;
  },

  document(post, blocks, options) {
    const facts = documentFacts(post, options);
    const lines = [`# ${facts.title}`, facts.summary, facts.url];
    if (facts.description) lines.push(`_${facts.description}_`);
    lines.push(...facts.notes);
    return `${lines.join('\n')}\n\n${blocks.join('\n\n')}\n`;
  },
};

const CSS = `
body { max-width: 42rem; margin: 2.5rem auto; padding: 0 1.25rem;
  font: 17px/1.65 Georgia, "Iowan Old Style", serif; color: #24211d; background: #fdfcfa; }
h1 { font-size: 1.45rem; line-height: 1.3; margin: 0 0 .4rem; }
.meta { margin: .15rem 0; color: #6a6259; font-size: .8rem;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif; }
.entry { margin: 2rem 0; }
.entry + .entry { border-top: 1px solid #e9e4db; padding-top: 1.25rem; }
.entry h2 { margin: 0 0 .6rem; font-size: .8rem; font-weight: 700; color: #6d4c7d;
  letter-spacing: .02em; text-transform: uppercase;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif; }
.entry h2 .icon { font-weight: 400; text-transform: none; color: #8a8279; }
.entry p { margin: 0 0 .8rem; }
blockquote { margin: .8rem 0; padding-left: 1rem; border-left: 3px solid #e9e4db; color: #4a453f; }
a { color: #6d4c7d; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; }
td, th { border: 1px solid #e9e4db; padding: .25rem .5rem; }
@media (prefers-color-scheme: dark) {
  body { background: #1c1a18; color: #ddd8d0; }
  .meta, blockquote { color: #9b948a; }
  .entry h2 { color: #c0a3d0; }
  .entry + .entry, blockquote, td, th { border-color: #35312d; }
  a { color: #c0a3d0; }
}
`.trim();

const html = {
  id: 'html',
  label: 'HTML (.html)',
  extension: 'html',
  mime: 'text/html',

  entry(entry, options) {
    const icon = options.icons !== false && entry.icon
      ? ` <span class="icon">${escapeHtml(oneLine(entry.icon))}</span>`
      : '';
    const body = htmlToCleanHtml(entry.html, options);
    return `<section class="entry">\n<h2>${escapeHtml(speakerLabel(entry))}${icon}</h2>\n${body}\n</section>`;
  },

  document(post, blocks, options) {
    const facts = documentFacts(post, options);
    const meta = [
      `<p class="meta">${escapeHtml(facts.summary)}</p>`,
      `<p class="meta"><a href="${escapeHtml(facts.url)}">${escapeHtml(facts.url)}</a></p>`,
    ];
    if (facts.description) meta.push(`<p class="meta">${escapeHtml(facts.description)}</p>`);
    for (const note of facts.notes) meta.push(`<p class="meta">${escapeHtml(note)}</p>`);

    return [
      '<!doctype html>',
      '<html lang="en">',
      '<meta charset="utf-8">',
      // A second line of defence for a file made of someone else's writing:
      // even if something unsafe reached the markup, this document can run no
      // script and fetch nothing but images.
      '<meta http-equiv="Content-Security-Policy" ' +
        'content="default-src \'none\'; style-src \'unsafe-inline\'; img-src https: data:">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${escapeHtml(facts.title)}</title>`,
      `<style>\n${CSS}\n</style>`,
      `<h1>${escapeHtml(facts.title)}</h1>`,
      ...meta,
      '',
      blocks.join('\n'),
      '</html>',
      '',
    ].join('\n');
  },
};

export const FORMATS = { markdown, html };

export function buildDocument(format, post, entries, options = {}) {
  const blocks = entries.map((entry) => format.entry(entry, options));
  return format.document(post, blocks, options);
}

/**
 * Splits into files small enough for one conversation, breaking only between
 * entries and repeating the header so each file stands on its own.
 */
export function splitDocument(format, post, entries, options = {}) {
  const { maxChars = DEFAULT_MAX_CHARS } = options;
  const blocks = entries.map((entry) => format.entry(entry, options));
  const groups = [[]];
  let size = 0;

  for (const block of blocks) {
    const current = groups[groups.length - 1];
    if (current.length && size + block.length > maxChars) {
      groups.push([block]);
      size = block.length;
    } else {
      current.push(block);
      size += block.length + 2;
    }
  }

  let entryIndex = 0;
  return groups.map((group, index) => {
    const first = entryIndex + 1;
    entryIndex += group.length;
    const part = groups.length > 1
      ? `Part ${index + 1} of ${groups.length} · entries ${first}–${entryIndex}`
      : null;
    return format.document(post, group, { ...options, part });
  });
}
