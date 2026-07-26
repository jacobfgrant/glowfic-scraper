import { parse } from './dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  entriesFromDocument,
  entryFromPost,
  entryFromReply,
  fileStem,
  openingAuthor,
  pageCount,
  parseThreadUrl,
  perPageFromDocument,
  replyRangeForPages,
} from '../src/glowfic.js';

const fixture = readFileSync(new URL('./fixtures/thread-page.html', import.meta.url), 'utf8');

const POST = {
  id: 4582,
  subject: 'mad investor chaos and the woman of asmodeus',
  description: 'some dath ilani are more Chaotic than others, but',
  num_replies: 4482,
  board: { id: 215, name: 'planecrash' },
  section: { id: 703, name: 'planecrash' },
  authors: [{ username: 'Iarwain' }, { username: 'lintamande' }],
  character: { id: 11729, name: 'Keltham', screenname: 'lawful chaotic' },
  icon: { keyword: 'brooding 1' },
  content: '<p>Keltham is having a <em>very</em> strange day.</p>',
};

test('thread URLs yield the post id and page', () => {
  assert.deepEqual(parseThreadUrl('https://glowfic.com/posts/4582'), {
    postId: 4582,
    page: 1,
    flat: false,
  });
  assert.deepEqual(parseThreadUrl('https://glowfic.com/posts/4582?page=7'), {
    postId: 4582,
    page: 7,
    flat: false,
  });
  assert.equal(parseThreadUrl('https://glowfic.com/posts/4582?view=flat').flat, true);
});

test('non-thread URLs are rejected', () => {
  assert.equal(parseThreadUrl('https://glowfic.com/boards/215'), null);
  assert.equal(parseThreadUrl('https://glowfic.com/'), null);
});

test('site pages map to reply index ranges', () => {
  assert.deepEqual(replyRangeForPages(1, 1, 25), { start: 0, end: 25 });
  assert.deepEqual(replyRangeForPages(3, 5, 25), { start: 50, end: 125 });
  assert.deepEqual(replyRangeForPages(2, 2, 100), { start: 100, end: 200 });
});

test('page count rounds up and never drops below one', () => {
  assert.equal(pageCount(369, 25), 15);
  assert.equal(pageCount(100, 25), 4);
  assert.equal(pageCount(0, 25), 1);
});

test('entries are read out of the rendered page', () => {
  const doc = parse(fixture);
  const entries = entriesFromDocument(doc);

  assert.equal(entries.length, 3);
  assert.equal(entries[0].name, 'Mountain');
  assert.equal(entries[0].username, 'Rockeye');
  assert.equal(entries[0].icon, 'confusion');
  assert.ok(entries[0].html.includes('respawned'));

  assert.equal(entries[1].name, null);
  assert.equal(entries[1].username, 'lintamande');
});

test('the reader per-page setting is read from the page, then the URL', () => {
  const doc = parse(fixture);
  assert.equal(perPageFromDocument(doc), 25);
  assert.equal(perPageFromDocument(doc, 'https://glowfic.com/posts/100?per_page=100'), 100);
});

test('download names are filesystem safe and identify the post', () => {
  assert.equal(fileStem(POST), 'mad-investor-chaos-and-the-woman-of-asmodeus-4582');
  assert.equal(fileStem({ id: 7, subject: 'Whose Line Is It, Anyway?!' }), 'whose-line-is-it-anyway-7');
});

test('an open-ended fetch reports progress without a bogus page total', async () => {
  const seen = [];
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [] });
  const { fetchReplies } = await import('../src/glowfic.js');
  await fetchReplies(100, { onProgress: (progress) => seen.push(progress) });
  assert.deepEqual(seen, [{ page: 1, pages: null }]);
});

test('requests carry credentials so locked threads are readable from either context', async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const { fetchPost } = await import('../src/glowfic.js');
  await fetchPost(100);

  assert.equal(seen.length, 1);
  // `same-origin` drops the session cookie when this runs in an isolated world.
  assert.equal(seen[0].init.credentials, 'include');
  assert.equal(seen[0].init.headers.Accept, 'application/json');
});

test('a blocked request explains itself instead of just saying "Load failed"', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('Load failed');
  };
  const { fetchPost } = await import('../src/glowfic.js');
  await assert.rejects(fetchPost(100), (error) => {
    assert.match(error.message, /Could not reach glowfic\.com/);
    assert.match(error.message, /Load failed/);
    return true;
  });
});

test('an HTTP error still reports its status', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const { fetchPost } = await import('../src/glowfic.js');
  await assert.rejects(fetchPost(100), /returned 500/);
});
