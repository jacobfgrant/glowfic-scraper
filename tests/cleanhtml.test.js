import './dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToCleanHtml } from '../src/cleanhtml.js';

test('paragraphs are kept, one per line', () => {
  const source = '<p>She is on an ocean.</p>\r\n<p>The boats are on fire.</p>';
  assert.equal(
    htmlToCleanHtml(source),
    '<p>She is on an ocean.</p>\n<p>The boats are on fire.</p>'
  );
});

test('empty nbsp-only paragraphs are dropped', () => {
  assert.equal(
    htmlToCleanHtml('<p>First.</p>\r\n<p>&nbsp;</p>\r\n<p>Second.</p>'),
    '<p>First.</p>\n<p>Second.</p>'
  );
});

test('emphasis is normalized to em and strong', () => {
  assert.equal(htmlToCleanHtml('<p><i>a</i> <b>b</b></p>'), '<p><em>a</em> <strong>b</strong></p>');
  assert.equal(htmlToCleanHtml('<p><strike>gone</strike></p>'), '<p><s>gone</s></p>');
});

test('styling attributes are stripped but the text survives', () => {
  assert.equal(
    htmlToCleanHtml('<p><span style="color:#f00" class="big">red</span></p>'),
    '<p>red</p>'
  );
  assert.equal(
    htmlToCleanHtml('<p style="margin:0" data-x="1">text</p>'),
    '<p>text</p>'
  );
});

test('scripts and styles are removed entirely', () => {
  assert.equal(
    htmlToCleanHtml('<p>safe</p><script>alert(1)</script><style>p{}</style>'),
    '<p>safe</p>'
  );
});

test('text is escaped so content cannot become markup', () => {
  assert.equal(htmlToCleanHtml('<p>a &lt; b &amp; c</p>'), '<p>a &lt; b &amp; c</p>');
});

test('links keep href only, absolutized', () => {
  assert.equal(
    htmlToCleanHtml('<p><a href="/posts/1" onclick="evil()" target="_blank">x</a></p>'),
    '<p><a href="https://glowfic.com/posts/1">x</a></p>'
  );
});

test('links can be flattened', () => {
  assert.equal(
    htmlToCleanHtml('<p><a href="/posts/1">x</a></p>', { links: false }),
    '<p>x</p>'
  );
});

test('images are dropped by default and kept on request', () => {
  assert.equal(htmlToCleanHtml('<p>a<img src="x.png" alt="cat">b</p>'), '<p>ab</p>');
  assert.equal(
    htmlToCleanHtml('<p><img src="x.png" alt="cat" width="9"></p>', { images: true }),
    '<p><img src="https://glowfic.com/x.png" alt="cat"></p>'
  );
});

test('line breaks, rules, quotes and lists are preserved', () => {
  assert.equal(htmlToCleanHtml('<p>one<br>two</p>'), '<p>one<br>two</p>');
  assert.equal(htmlToCleanHtml('<blockquote><p>q</p></blockquote>'), '<blockquote><p>q</p></blockquote>');
  assert.equal(htmlToCleanHtml('<ul><li>a</li><li>b</li></ul>'), '<ul><li>a</li>\n<li>b</li></ul>');
});

test('headings inside a reply keep weight but not level', () => {
  const output = htmlToCleanHtml('<h2>Title</h2><p>body</p>');
  assert.equal(output, '<p><strong>Title</strong></p>\n<p>body</p>');
  assert.ok(!/<h[1-6]/.test(output));
});

test('a div of plain text becomes a paragraph, a div of blocks is unwrapped', () => {
  assert.equal(htmlToCleanHtml('<div>loose text</div>'), '<p>loose text</p>');
  assert.equal(htmlToCleanHtml('<div><p>a</p><p>b</p></div>'), '<p>a</p>\n<p>b</p>');
});

test('an image-only paragraph is not dropped when images are kept', () => {
  assert.equal(
    htmlToCleanHtml('<p><img src="x.png" alt=""></p>', { images: true }),
    '<p><img src="https://glowfic.com/x.png" alt=""></p>'
  );
});

test('empty input yields an empty string', () => {
  assert.equal(htmlToCleanHtml(''), '');
  assert.equal(htmlToCleanHtml(null), '');
});
