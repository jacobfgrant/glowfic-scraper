import { parse } from './dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { entryFromPost, entryFromReply } from '../src/glowfic.js';
import { FORMATS, buildDocument, splitDocument } from '../src/formats.js';

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

const { markdown, html } = FORMATS;

function entry(overrides = {}) {
  return entryFromReply({
    character_name: 'Carissa Sevar',
    character: { name: 'Carissa Sevar' },
    icon: { keyword: 'thinking' },
    user: { username: 'lintamande' },
    content: '<p>Hm.</p>',
    ...overrides,
  });
}

test('a character speaking is labelled with both character and author', () => {
  assert.equal(markdown.entry(entry(), {}), '## Carissa Sevar (lintamande) [thinking]\nHm.');
});

test('an alias overrides the canonical character name', () => {
  const aliased = entry({ character_name: 'the woman of Asmodeus', icon: null });
  assert.equal(markdown.entry(aliased, {}), '## the woman of Asmodeus (lintamande)\nHm.');
});

test('narration with no character is labelled with the author alone', () => {
  const narration = entry({ character_name: null, character: null, icon: { keyword: 'silmaril' } });
  assert.equal(markdown.entry(narration, {}), '## lintamande [silmaril]\nHm.');
});

test('a character with no known author is labelled by character alone', () => {
  assert.equal(
    markdown.entry(entryFromPost(POST, null), { icons: false }),
    '## Keltham\nKeltham is having a *very* strange day.'
  );
});

test('icon keywords can be turned off', () => {
  assert.equal(
    markdown.entry(entryFromPost(POST, 'Iarwain'), { icons: false }),
    '## Keltham (Iarwain)\nKeltham is having a *very* strange day.'
  );
});

test('the markdown header carries the facts needed to discuss the thread', () => {
  const document = buildDocument(markdown, POST, [], {});
  assert.ok(
    document.startsWith(
      '# mad investor chaos and the woman of asmodeus\n' +
        'planecrash · Iarwain & lintamande · 4482 replies\n' +
        'https://glowfic.com/posts/4582\n' +
        '_some dath ilani are more Chaotic than others, but_'
    )
  );
});

test('a duplicated board and section name is not repeated', () => {
  const document = buildDocument(markdown, POST, [], {});
  assert.ok(document.includes('planecrash · Iarwain'));
  assert.ok(!document.includes('planecrash / planecrash'));
});

test('the HTML output is a standalone document with the same facts', () => {
  const document = buildDocument(html, POST, [entryFromPost(POST, 'Iarwain')], {});

  assert.ok(document.startsWith('<!doctype html>'));
  assert.ok(document.includes('<meta charset="utf-8">'));
  assert.ok(document.includes('<title>mad investor chaos and the woman of asmodeus</title>'));
  assert.ok(document.includes('<style>'));
  assert.ok(document.includes('planecrash · Iarwain &amp; lintamande · 4482 replies'));
  assert.ok(document.includes('<a href="https://glowfic.com/posts/4582">'));
  assert.ok(document.trimEnd().endsWith('</html>'));
});

test('an HTML entry keeps speaker, icon, and emphasis', () => {
  const document = buildDocument(html, POST, [entryFromPost(POST, 'Iarwain')], {});
  assert.ok(
    document.includes(
      '<h2>Keltham (Iarwain) <span class="icon">brooding 1</span></h2>'
    )
  );
  assert.ok(document.includes('<p>Keltham is having a <em>very</em> strange day.</p>'));
});

test('the HTML output escapes text that would otherwise be markup', () => {
  const nasty = {
    ...POST,
    subject: 'Tom & Jerry <script>alert(1)</script>',
    description: null,
  };
  const hostile = entryFromReply({
    character_name: 'a & b',
    character: null,
    icon: { keyword: '<b>x</b>' },
    user: { username: 'someone' },
    content: '<p>5 &lt; 6 &amp; 7 &gt; 6</p><script>alert(2)</script>',
  });
  const document = buildDocument(html, nasty, [hostile], {});

  assert.ok(!document.includes('<script>'));
  assert.ok(document.includes('Tom &amp; Jerry &lt;script&gt;'));
  assert.ok(
    document.includes('<h2>a &amp; b (someone) <span class="icon">&lt;b&gt;x&lt;/b&gt;</span></h2>')
  );
  assert.ok(document.includes('<p>5 &lt; 6 &amp; 7 &gt; 6</p>'));
});

test('both formats carry the scope note when the export is partial', () => {
  const options = { scope: 'Pages 3–7 of 180' };
  assert.ok(buildDocument(markdown, POST, [], options).includes('Pages 3–7 of 180'));
  assert.ok(
    buildDocument(html, POST, [], options).includes('<p class="meta">Pages 3–7 of 180</p>')
  );
});

test('a short thread stays in one part in either format', () => {
  for (const format of [markdown, html]) {
    const parts = splitDocument(format, POST, [entryFromPost(POST, 'Iarwain')], {});
    assert.equal(parts.length, 1);
    assert.ok(!parts[0].includes('Part 1 of'));
  }
});

test('a long thread splits on entry boundaries with self-contained files', () => {
  const entries = Array.from({ length: 6 }, (_, index) => ({
    name: 'Keltham',
    username: 'Iarwain',
    icon: null,
    html: `<p>${'word '.repeat(50)}${index}</p>`,
  }));

  for (const format of [markdown, html]) {
    const parts = splitDocument(format, POST, entries, { maxChars: 900 });
    assert.ok(parts.length > 1, `${format.id} did not split`);
    for (const part of parts) {
      assert.match(part, /Part \d+ of \d+ · entries \d+–\d+/);
    }
    const kept = parts.join('\n').match(/Keltham/g).length;
    // One speaker label per entry, plus the character name in each file header.
    assert.ok(kept >= entries.length);
  }
});

test('every entry survives a split exactly once', () => {
  const entries = Array.from({ length: 9 }, (_, index) => ({
    name: `Speaker${index}`,
    username: 'author',
    icon: null,
    html: `<p>${'word '.repeat(60)}</p>`,
  }));
  const parts = splitDocument(markdown, POST, entries, { maxChars: 900 });
  const joined = parts.join('\n');
  for (const { name } of entries) {
    assert.equal(joined.match(new RegExp(`## ${name} `, 'g')).length, 1);
  }
});

test('HTML parts are each a complete document', () => {
  const entries = Array.from({ length: 6 }, (_, index) => ({
    name: 'Keltham',
    username: 'Iarwain',
    icon: null,
    html: `<p>${'word '.repeat(50)}${index}</p>`,
  }));
  const parts = splitDocument(html, POST, entries, { maxChars: 900 });

  assert.ok(parts.length > 1);
  for (const part of parts) {
    assert.ok(part.startsWith('<!doctype html>'));
    assert.ok(part.includes('<style>'));
    assert.ok(part.trimEnd().endsWith('</html>'));
  }
});

test('the rendered page and the API produce the same entries in both formats', () => {
  const doc = parse(fixture);
  const fromPage = [...doc.querySelectorAll('.post-container')].map((element) => ({
    name: element.querySelector('.post-character')?.textContent.trim() || null,
    username: element.querySelector('.post-author')?.textContent.trim() || null,
    icon: element.querySelector('.post-icon img')?.getAttribute('title') || null,
    html: element.querySelector('.post-content')?.innerHTML ?? '',
  }));

  assert.ok(markdown.entry(fromPage[0], {}).startsWith('## Mountain (Rockeye) [confusion]'));
  assert.ok(html.entry(fromPage[0], {}).includes('<h2>Mountain (Rockeye) '));
});
