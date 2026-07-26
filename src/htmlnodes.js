// Shared by the two converters. Both walk the same DOM and face the same
// hostile input; anything they must agree on lives here rather than in two
// copies that can drift apart.

export const TEXT_NODE = 3;
export const ELEMENT_NODE = 1;

export const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
export const DROPPED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

const SITE_ORIGIN = 'https://glowfic.com';
const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Resolves a URL from reply content, or null if it is not safe to emit.
 *
 * Reply content is written by anyone with an account, and the exports get
 * opened in a browser, so a `javascript:` or `data:` href would be live code in
 * a file the reader believes is their own transcript. Only http(s) survives.
 */
export function safeUrl(href) {
  if (!href) return null;
  let url;
  try {
    url = new URL(href, SITE_ORIGIN);
  } catch {
    return null;
  }
  return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
}

/** Collapses the editor's whitespace, including the non-breaking kind. */
export function normalizeSpace(value) {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
}
