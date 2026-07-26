// Reads a glowfic thread and renders it as a plain markdown transcript.
//
// Entries from the JSON API and entries scraped from the rendered page are
// normalized to the same shape so everything downstream is shared.

import { htmlToMarkdown } from './markdown.js';

const API_PER_PAGE = 100;
const REQUEST_GAP_MS = 120;
const CHARS_PER_TOKEN = 4;

/** Pulls the post id and current page out of a glowfic thread URL. */
export function parseThreadUrl(href) {
  const url = new URL(href, 'https://glowfic.com');
  const match = url.pathname.match(/^\/posts\/(\d+)/);
  if (!match) return null;
  return {
    postId: Number(match[1]),
    page: Number(url.searchParams.get('page')) || 1,
    flat: url.searchParams.get('view') === 'flat',
  };
}

/** Site page numbers to the half-open range of reply indices they contain. */
export function replyRangeForPages(firstPage, lastPage, perPage) {
  return { start: (firstPage - 1) * perPage, end: lastPage * perPage };
}

export function pageCount(replyCount, perPage) {
  return Math.max(1, Math.ceil(replyCount / perPage));
}

async function fetchJson(path, signal) {
  const response = await fetch(`https://glowfic.com/api/v1${path}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (response.status === 403) {
    throw new Error('Glowfic says this thread is not readable by the current login.');
  }
  if (!response.ok) {
    throw new Error(`Glowfic API returned ${response.status} for ${path}`);
  }
  return response.json();
}

export function fetchPost(postId, signal) {
  return fetchJson(`/posts/${postId}`, signal);
}

/**
 * Fetches replies covering the half-open index range, one API page at a time so
 * a long thread does not fire fifty simultaneous requests at the site.
 */
export async function fetchReplies(postId, { start, end, onProgress, signal } = {}) {
  const firstPage = Math.floor((start ?? 0) / API_PER_PAGE) + 1;
  const lastPage = Math.floor(Math.max(0, (end ?? Infinity) - 1) / API_PER_PAGE) + 1;
  // An open-ended read stops when a short batch comes back, so there is no
  // page total to report until then.
  const total = Number.isFinite(lastPage) ? lastPage - firstPage + 1 : null;
  const replies = [];

  for (let page = firstPage; page <= lastPage; page += 1) {
    const batch = await fetchJson(
      `/posts/${postId}/replies?page=${page}&per_page=${API_PER_PAGE}`,
      signal
    );
    replies.push(...batch);
    onProgress?.({ page: page - firstPage + 1, pages: total });
    if (batch.length < API_PER_PAGE) break;
    if (page < lastPage) await sleep(REQUEST_GAP_MS);
  }

  const offset = (firstPage - 1) * API_PER_PAGE;
  return replies.slice((start ?? 0) - offset, end === undefined ? undefined : end - offset);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function entryFromPost(post, username = null) {
  return {
    name: post.character?.name ?? null,
    username,
    icon: post.icon?.keyword ?? null,
    html: post.content ?? '',
  };
}

/**
 * The post endpoint reports every author of the thread but not which of them
 * wrote the opening post, so recover it from the rendered page if it happens to
 * be on screen, otherwise from the next time that character tags in.
 */
export function openingAuthor(post, replies = [], doc = null) {
  const rendered = doc
    ?.querySelector('.post-container.post-post .post-author')
    ?.textContent.trim();
  if (rendered) return rendered;

  if (post.character?.id) {
    const match = replies.find((reply) => reply.character?.id === post.character.id);
    if (match?.user?.username) return match.user.username;
  }
  return null;
}

export function entryFromReply(reply) {
  return {
    name: reply.character_name ?? reply.character?.name ?? null,
    username: reply.user?.username ?? null,
    icon: reply.icon?.keyword ?? null,
    html: reply.content ?? '',
  };
}

/** Reads one `.post-container` out of the rendered page. */
export function entryFromElement(element) {
  const text = (selector) => element.querySelector(selector)?.textContent.trim() || null;
  return {
    name: text('.post-character'),
    username: text('.post-author'),
    icon: element.querySelector('.post-icon img')?.getAttribute('title') || null,
    html: element.querySelector('.post-content')?.innerHTML ?? '',
  };
}

export function entriesFromDocument(doc) {
  return [...doc.querySelectorAll('.post-container')].map(entryFromElement);
}

/**
 * Reads the per-page setting the reader currently has selected on the site,
 * which is what "page 3" means to her and so what page ranges must be based on.
 */
export function perPageFromDocument(doc, href) {
  const fromUrl = Number(new URL(href ?? 'https://glowfic.com', 'https://glowfic.com')
    .searchParams.get('per_page'));
  if (fromUrl) return fromUrl;
  const select = doc.querySelector('select.per-page');
  const live = Number(select?.value);
  if (live) return live;
  return Number(select?.querySelector('option[selected]')?.value) || 25;
}

export function formatEntry(entry, options = {}) {
  const opts = { icons: true, ...options };
  const icon = opts.icons && entry.icon ? ` [${entry.icon}]` : '';
  const body = htmlToMarkdown(entry.html, opts);
  return `## ${speakerLabel(entry)}${icon}\n${body}`;
}

function speakerLabel({ name, username }) {
  if (name && username && name !== username) return `${name} (${username})`;
  return name || username || 'unknown';
}

export function buildHeader(post, { scope, part } = {}) {
  const authors = (post.authors ?? []).map((author) => author.username).join(' & ');
  const board = [...new Set([post.board?.name, post.section?.name].filter(Boolean))].join(' / ');
  const facts = [board, authors, `${post.num_replies} replies`].filter(Boolean);

  const lines = [`# ${post.subject}`, facts.join(' · '), `https://glowfic.com/posts/${post.id}`];
  if (post.description) lines.push(`_${post.description}_`);
  if (scope) lines.push(scope);
  if (part) lines.push(part);
  return lines.join('\n');
}

export function buildTranscript(post, entries, options = {}) {
  const body = entries.map((entry) => formatEntry(entry, options)).join('\n\n');
  return `${buildHeader(post, options)}\n\n${body}\n`;
}

/**
 * Splits a transcript into parts small enough for one conversation, breaking
 * only between entries and repeating the header so each part stands alone.
 */
export function splitTranscript(post, entries, options = {}) {
  const { maxChars = 300_000 } = options;
  const blocks = entries.map((entry) => formatEntry(entry, options));
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
    const header = buildHeader(post, { ...options, part });
    return `${header}\n\n${group.join('\n\n')}\n`;
  });
}

export function estimateTokens(text) {
  return Math.round(text.length / CHARS_PER_TOKEN);
}

/** Filesystem-safe stem for downloads, e.g. mad-investor-chaos-4582. */
export function fileStem(post) {
  const slug = (post.subject || 'glowfic')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${slug || 'glowfic'}-${post.id}`;
}
