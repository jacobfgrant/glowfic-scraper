import { parse } from './dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildHeader,
  entriesFromDocument,
  entryFromPost,
  entryFromReply,
  fileStem,
  formatEntry,
  openingAuthor,
  pageCount,
  parseThreadUrl,
  perPageFromDocument,
  replyRangeForPages,
  splitTranscript,
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

test('a character speaking is labelled with both character and author', () => {
  const entry = entryFromReply({
    character_name: 'Carissa Sevar',
    character: { name: 'Carissa Sevar' },
    icon: { keyword: 'thinking' },
    user: { username: 'lintamande' },
    content: '<p>Hm.</p>',
  });
  assert.equal(formatEntry(entry), '## Carissa Sevar (lintamande) [thinking]\nHm.');
});

test('an alias overrides the canonical character name', () => {
  const entry = entryFromReply({
    character_name: 'the woman of Asmodeus',
    character: { name: 'Carissa Sevar' },
    icon: null,
    user: { username: 'lintamande' },
    content: '<p>Hm.</p>',
  });
  assert.equal(formatEntry(entry), '## the woman of Asmodeus (lintamande)\nHm.');
});

test('narration with no character is labelled with the author alone', () => {
  const entry = entryFromReply({
    character_name: null,
    character: null,
    icon: { keyword: 'silmaril' },
    user: { username: 'lintamande' },
    content: '<p>This place is very cold.</p>',
  });
  assert.equal(formatEntry(entry), '## lintamande [silmaril]\nThis place is very cold.');
});

test('icon keywords can be turned off', () => {
  const entry = entryFromPost(POST, 'Iarwain');
  assert.equal(
    formatEntry(entry, { icons: false }),
    '## Keltham (Iarwain)\nKeltham is having a *very* strange day.'
  );
});

test('the opening author is read from the page when it is on screen', () => {
  const doc = parse(fixture);
  assert.equal(openingAuthor(POST, [], doc), 'Rockeye');
});

test('the opening author falls back to the next tag by the same character', () => {
  const replies = [
    { character: { id: 99 }, user: { username: 'someone-else' } },
    { character: { id: 11729 }, user: { username: 'Iarwain' } },
  ];
  assert.equal(openingAuthor(POST, replies, null), 'Iarwain');
});

test('an unknown opening author is omitted rather than invented', () => {
  const post = { ...POST, character: null };
  assert.equal(openingAuthor(post, [], null), null);
  assert.equal(
    formatEntry(entryFromPost(post, null), { icons: false }),
    '## unknown\nKeltham is having a *very* strange day.'
  );
});

test('a character with no known author is labelled by character alone', () => {
  assert.equal(
    formatEntry(entryFromPost(POST, null), { icons: false }),
    '## Keltham\nKeltham is having a *very* strange day.'
  );
});

test('the header carries the facts needed to discuss the thread', () => {
  const header = buildHeader(POST);
  assert.equal(
    header,
    '# mad investor chaos and the woman of asmodeus\n' +
      'planecrash · Iarwain & lintamande · 4482 replies\n' +
      'https://glowfic.com/posts/4582\n' +
      '_some dath ilani are more Chaotic than others, but_'
  );
});

test('a duplicated board and section name is not repeated', () => {
  assert.ok(buildHeader(POST).includes('planecrash · Iarwain'));
  assert.ok(!buildHeader(POST).includes('planecrash / planecrash'));
});

test('a short thread stays in one part', () => {
  const entries = [entryFromPost(POST)];
  const parts = splitTranscript(POST, entries, { maxChars: 300_000 });
  assert.equal(parts.length, 1);
  assert.ok(!parts[0].includes('Part 1 of'));
});

test('a long thread splits on entry boundaries with a self-contained header', () => {
  const entries = Array.from({ length: 6 }, (_, i) => ({
    name: 'Keltham',
    username: 'Iarwain',
    icon: null,
    html: `<p>${'word '.repeat(50)}${i}</p>`,
  }));
  const parts = splitTranscript(POST, entries, { maxChars: 600 });

  assert.ok(parts.length > 1);
  for (const part of parts) {
    assert.ok(part.startsWith('# mad investor chaos'));
    assert.ok(/Part \d+ of \d+ · entries \d+–\d+/.test(part));
  }
  // Every entry survives the split exactly once.
  const kept = parts.join('\n').match(/## Keltham/g).length;
  assert.equal(kept, entries.length);
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
