import './dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToMarkdown } from '../src/markdown.js';

test('paragraphs become blank-line separated blocks', () => {
  const html = '<p>She is on an ocean.</p>\r\n<p>The boats are on fire.</p>';
  assert.equal(htmlToMarkdown(html), 'She is on an ocean.\n\nThe boats are on fire.');
});

test('empty nbsp-only paragraphs collapse instead of leaving gaps', () => {
  const html = '<p>First.</p>\r\n<p>&nbsp;</p>\r\n<p>Second.</p>';
  assert.equal(htmlToMarkdown(html), 'First.\n\nSecond.');
});

test('emphasis maps to markdown', () => {
  assert.equal(htmlToMarkdown('<p><em>very</em> strange</p>'), '*very* strange');
  assert.equal(htmlToMarkdown('<p><strong>no</strong></p>'), '**no**');
  assert.equal(htmlToMarkdown('<p><s>gone</s></p>'), '~~gone~~');
});

test('whitespace stays outside emphasis markers', () => {
  assert.equal(htmlToMarkdown('<p>a<em> b </em>c</p>'), 'a *b* c');
});

test('nested emphasis is preserved', () => {
  assert.equal(
    htmlToMarkdown('<p><em>a <strong>b</strong> c</em></p>'),
    '*a **b** c*'
  );
});

test('br becomes a single newline inside a block', () => {
  assert.equal(htmlToMarkdown('<p>one<br>two</p>'), 'one\ntwo');
});

test('span styling is dropped but its text is kept', () => {
  assert.equal(
    htmlToMarkdown('<p><span style="color: #ff0000;">red words</span></p>'),
    'red words'
  );
});

test('links keep their text and absolutize site-relative hrefs', () => {
  assert.equal(
    htmlToMarkdown('<p>see <a href="/posts/4582">this</a></p>'),
    'see [this](https://glowfic.com/posts/4582)'
  );
});

test('links can be flattened to plain text', () => {
  assert.equal(
    htmlToMarkdown('<p>see <a href="/posts/4582">this</a></p>', { links: false }),
    'see this'
  );
});

test('images are dropped by default', () => {
  assert.equal(htmlToMarkdown('<p>a <img src="x.png" alt="cat"> b</p>'), 'a b');
});

test('blockquotes are prefixed', () => {
  assert.equal(
    htmlToMarkdown('<blockquote><p>quoted</p></blockquote>'),
    '> quoted'
  );
});

test('lists render as markdown lists', () => {
  assert.equal(
    htmlToMarkdown('<ul><li>one</li><li>two</li></ul>'),
    '- one\n- two'
  );
  assert.equal(
    htmlToMarkdown('<ol><li>one</li><li>two</li></ol>'),
    '1. one\n2. two'
  );
});

test('headings inside a reply become bold, never markdown headings', () => {
  const output = htmlToMarkdown('<h2>A Title</h2><p>body</p>');
  assert.equal(output, '**A Title**\n\nbody');
  assert.ok(!output.split('\n').some((line) => line.startsWith('#')));
});

test('prose starting with a hash is escaped so it cannot fake a speaker header', () => {
  assert.equal(htmlToMarkdown('<p>#1 priority</p>'), '\\#1 priority');
});

test('non-breaking spaces become ordinary spaces', () => {
  assert.equal(htmlToMarkdown('<p>a&nbsp;b</p>'), 'a b');
});

test('empty input yields an empty string', () => {
  assert.equal(htmlToMarkdown(''), '');
  assert.equal(htmlToMarkdown(null), '');
});
