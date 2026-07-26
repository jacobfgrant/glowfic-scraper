// Exercises the panel wiring against a jsdom page built from real glowfic
// markup, with the API stubbed. It is not a substitute for clicking the
// bookmarklet in Chrome, but it catches wiring mistakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const fixture = readFileSync(new URL('./fixtures/thread-page.html', import.meta.url), 'utf8');

const POST = {
  id: 100,
  subject: 'New neighbors. Just as frustrating.',
  description: 'Mountain and Elves',
  num_replies: 369,
  board: { id: 3, name: 'Sandboxes' },
  section: null,
  authors: [{ username: 'lintamande' }, { username: 'Rockeye' }],
  character: { id: 588, name: 'Mountain' },
  icon: { keyword: 'confusion' },
  content: '<p>She does not feel any tiles.</p>',
};

const REPLY = {
  id: 1,
  character_name: null,
  character: null,
  icon: { keyword: 'Celegorm' },
  user: { username: 'lintamande' },
  content: "<p>She's on an ocean.</p>",
};

function setupPage({ url = 'https://glowfic.com/posts/100', replies = [REPLY] } = {}) {
  const dom = new JSDOM(fixture, { url });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.alert = () => {};

  const calls = [];
  globalThis.fetch = async (target) => {
    calls.push(target);
    const body = target.includes('/replies') ? replies : POST;
    return { ok: true, status: 200, json: async () => body };
  };
  return { dom, calls };
}

async function openReadyPanel(options) {
  const context = setupPage(options);
  const { openPanel } = await import('../src/panel.js');
  const panel = openPanel();
  await panel.ready;
  return { panel, ...context };
}

test('the panel loads thread metadata and offers the right scopes', async () => {
  const { panel } = await openReadyPanel();
  const $ = (selector) => panel.root.querySelector(selector);

  assert.equal($('.title').textContent, 'New neighbors. Just as frustrating.');
  assert.equal($('.sub').textContent, 'lintamande, Rockeye · 369 replies · 15 pages');
  assert.equal($('.all-label').textContent, 'Whole thread (370 entries)');
  assert.equal($('.page-label').textContent, 'This page (1 of 15)');
  assert.equal($('.fetch').disabled, false);
  panel.close();
});

test('"this page" reads the rendered page and makes no API calls for replies', async () => {
  const { panel, calls } = await openReadyPanel();
  const $ = (selector) => panel.root.querySelector(selector);

  $('input[name=scope][value=page]').checked = true;
  $('.fetch').click();
  await panel.busy;

  assert.equal(calls.filter((url) => url.includes('/replies')).length, 0);
  assert.equal(panel.entries.length, 3);
  assert.ok(panel.output().includes('## Mountain (Rockeye) [confusion]'));
  assert.ok(panel.output().includes('Page 1 of 15'));
  assert.equal($('.result').hidden, false);
  panel.close();
});

test('"whole thread" pulls replies from the API and prepends the opening post', async () => {
  const { panel, calls } = await openReadyPanel();
  const $ = (selector) => panel.root.querySelector(selector);

  $('input[name=scope][value=all]').checked = true;
  $('.fetch').click();
  await panel.busy;

  assert.ok(calls.some((url) => url.includes('/posts/100/replies?page=1&per_page=100')));
  assert.equal(panel.entries.length, 2);
  const transcript = panel.output();
  assert.ok(transcript.startsWith('# New neighbors. Just as frustrating.'));
  assert.ok(transcript.includes('## Mountain (Rockeye) [confusion]'));
  assert.ok(transcript.includes('## lintamande [Celegorm]'));
  panel.close();
});

test('a page range requests only the pages it needs and omits the opening post', async () => {
  const { panel, calls } = await openReadyPanel({ url: 'https://glowfic.com/posts/100?page=6' });
  const $ = (selector) => panel.root.querySelector(selector);

  $('input[name=scope][value=range]').checked = true;
  $('.from').value = '6';
  $('.to').value = '8';
  $('.fetch').click();
  await panel.busy;

  // Site pages 6-8 at 25 per page are replies 125-199, which live on API page 2.
  assert.ok(calls.some((url) => url.includes('replies?page=2&per_page=100')));
  assert.ok(!calls.some((url) => url.includes('replies?page=1&per_page=100')));
  assert.ok(!panel.output().includes('does not feel any tiles'));
  assert.ok(panel.output().includes('Pages 6–8 of 15'));
  panel.close();
});

test('icon keywords and links can be switched off before exporting', async () => {
  const { panel } = await openReadyPanel();
  const $ = (selector) => panel.root.querySelector(selector);

  $('.icons').checked = false;
  $('input[name=scope][value=page]').checked = true;
  $('.fetch').click();
  await panel.busy;

  assert.ok(panel.output().includes('## Mountain (Rockeye)\n'));
  assert.ok(!panel.output().includes('[confusion]'));
  panel.close();
});

test('the size readout describes what was fetched', async () => {
  const { panel } = await openReadyPanel();
  const $ = (selector) => panel.root.querySelector(selector);

  $('input[name=scope][value=page]').checked = true;
  $('.fetch').click();
  await panel.busy;

  assert.match($('.size').textContent, /^3 entries · [\d,]+ characters · ~\d+k tokens$/);
  assert.equal($('.download').textContent, 'Download .md');
  assert.equal($('.warn').hidden, true);
  panel.close();
});

test('a thread too large to paste warns and offers split downloads', async () => {
  const bulky = Array.from({ length: 40 }, (_, i) => ({
    ...REPLY,
    id: i,
    content: `<p>${'word '.repeat(2000)}</p>`,
  }));
  const { panel, dom } = await openReadyPanel({ replies: bulky });
  const $ = (selector) => panel.root.querySelector(selector);

  $('input[name=scope][value=all]').checked = true;
  $('.fetch').click();
  await panel.busy;

  assert.ok(panel.output().length > 250_000);
  assert.equal($('.warn').hidden, false);
  assert.match($('.warn').textContent, /download and attach/i);
  assert.match($('.download').textContent, /Download \d+ files/);

  // Changing the split size recomputes the file count without refetching.
  const before = $('.download').textContent;
  $('.chunk').value = '50';
  $('.chunk').dispatchEvent(new dom.window.Event('input'));
  assert.notEqual($('.download').textContent, before);
  assert.match($('.download').textContent, /Download \d+ files/);
  panel.close();
});

test('an inaccessible thread reports the access error instead of failing silently', async () => {
  setupPage();
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  const { openPanel } = await import('../src/panel.js');
  const panel = openPanel();
  await panel.ready;

  assert.match(panel.root.querySelector('.status').textContent, /not readable by the current login/);
  panel.close();
});

test('the panel refuses to run outside a thread page', async () => {
  setupPage({ url: 'https://glowfic.com/boards/3' });
  let warned = '';
  globalThis.alert = (message) => {
    warned = message;
  };
  const { openPanel } = await import('../src/panel.js');

  assert.equal(openPanel(), undefined);
  assert.match(warned, /Open a glowfic thread first/);
  assert.equal(document.getElementById('glowfic-clean-export'), null);
});

test('switching format changes the output, extension, and size without refetching', async () => {
  const { panel, dom, calls } = await openReadyPanel();
  const $ = (selector) => panel.root.querySelector(selector);

  $('input[name=scope][value=page]').checked = true;
  $('.fetch').click();
  await panel.busy;

  const requests = calls.length;
  const markdownSize = $('.size').textContent;
  assert.equal($('.download').textContent, 'Download .md');

  $('.format').value = 'html';
  $('.format').dispatchEvent(new dom.window.Event('input'));

  assert.equal(calls.length, requests, 'switching format refetched');
  assert.equal($('.download').textContent, 'Download .html');
  assert.notEqual($('.size').textContent, markdownSize);
  assert.ok(panel.output().startsWith('<!doctype html>'));
  assert.ok(panel.output().includes('<h2>Mountain (Rockeye) <span class="icon">confusion</span></h2>'));
  panel.close();
});

test('a split export offers a button per part for browsers that drop batch saves', async () => {
  const bulky = Array.from({ length: 12 }, (_, i) => ({
    ...REPLY,
    id: i,
    content: `<p>${'word '.repeat(2000)}</p>`,
  }));
  const { panel, dom } = await openReadyPanel({ replies: bulky });
  const $ = (selector) => panel.root.querySelector(selector);

  const saved = [];
  globalThis.URL.createObjectURL = () => 'blob:test';
  globalThis.URL.revokeObjectURL = () => {};
  const realCreate = dom.window.document.createElement.bind(dom.window.document);
  dom.window.document.createElement = (tag) => {
    const element = realCreate(tag);
    if (tag === 'a') element.click = () => saved.push(element.download);
    return element;
  };

  $('input[name=scope][value=all]').checked = true;
  $('.fetch').click();
  await panel.busy;

  $('.chunk').value = '20';
  $('.chunk').dispatchEvent(new dom.window.Event('input'));

  const count = panel.parts().length;
  assert.ok(count > 2, `expected several parts, got ${count}`);
  assert.equal($('.parts').hidden, false);
  assert.equal($('.parts').querySelectorAll('button').length, count);

  $('.parts').querySelectorAll('button')[1].click();
  assert.deepEqual(saved, ['new-neighbors-just-as-frustrating-100-part2.md']);
  assert.match($('.status').textContent, /Saved part 2 of \d+/);
  panel.close();
});

test('a whole-thread download saves every part, spaced out', async () => {
  const bulky = Array.from({ length: 12 }, (_, i) => ({
    ...REPLY,
    id: i,
    content: `<p>${'word '.repeat(2000)}</p>`,
  }));
  const { panel, dom } = await openReadyPanel({ replies: bulky });
  const $ = (selector) => panel.root.querySelector(selector);

  const saved = [];
  globalThis.URL.createObjectURL = () => 'blob:test';
  globalThis.URL.revokeObjectURL = () => {};
  const realCreate = dom.window.document.createElement.bind(dom.window.document);
  dom.window.document.createElement = (tag) => {
    const element = realCreate(tag);
    if (tag === 'a') element.click = () => saved.push(element.download);
    return element;
  };

  $('input[name=scope][value=all]').checked = true;
  $('.fetch').click();
  await panel.busy;
  $('.chunk').value = '20';
  $('.chunk').dispatchEvent(new dom.window.Event('input'));

  const expected = panel.parts().length;
  await panel.download();

  assert.equal(saved.length, expected);
  assert.equal(new Set(saved).size, expected, 'parts overwrote each other');
  assert.match($('.status').textContent, /Saved \d+ files/);
  panel.close();
});

test('on www.glowfic.com every request stays on www', async () => {
  // Requesting the apex from a www page is cross-origin, and glowfic sends no
  // CORS headers, so the browser refuses it before it ever returns.
  const { panel, calls } = await openReadyPanel({ url: 'https://www.glowfic.com/posts/100' });
  const $ = (selector) => panel.root.querySelector(selector);

  $('input[name=scope][value=all]').checked = true;
  $('.fetch').click();
  await panel.busy;

  assert.ok(calls.length >= 2, 'expected a post fetch and a replies fetch');
  for (const url of calls) {
    assert.ok(
      String(url).startsWith('https://www.glowfic.com/'),
      `went cross-origin: ${url}`
    );
  }
  panel.close();
});

test('on the apex host every request stays on the apex', async () => {
  const { panel, calls } = await openReadyPanel({ url: 'https://glowfic.com/posts/100' });
  const $ = (selector) => panel.root.querySelector(selector);

  $('input[name=scope][value=all]').checked = true;
  $('.fetch').click();
  await panel.busy;

  for (const url of calls) {
    assert.ok(String(url).startsWith('https://glowfic.com/'), `went cross-origin: ${url}`);
  }
  panel.close();
});
