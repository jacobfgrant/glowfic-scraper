// Builds the real bundle and runs it in a page, because a syntax check does not
// catch modules colliding once their scopes are flattened together.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { NEW_NEIGHBORS as POST } from './fixtures.js';
import { distFile } from './dist.js';

const fixture = readFileSync(new URL('./fixtures/thread-page.html', import.meta.url), 'utf8');

function build() {
  return distFile('bookmarklet.js');
}

async function settle(check, attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}

test('the built bundle runs in a page and opens the panel', async () => {
  const source = build();
  const dom = new JSDOM(fixture, {
    url: 'https://glowfic.com/posts/100',
    runScripts: 'outside-only',
  });
  dom.window.fetch = async (target) => ({
    ok: true,
    status: 200,
    json: async () => (String(target).includes('/replies') ? [] : POST),
  });
  dom.window.alert = () => {};

  dom.window.eval(source);

  const host = dom.window.document.getElementById('glowfic-transcript');
  assert.ok(host, 'the bundle did not attach its panel');

  const $ = (selector) => host.shadowRoot.querySelector(selector);
  assert.ok($('.panel'), 'the panel did not render');

  const loaded = await settle(() => $('.title').textContent !== 'Loading…');
  assert.ok(loaded, 'the panel never loaded thread metadata');
  assert.equal($('.title').textContent, 'New neighbors. Just as frustrating.');
  assert.equal($('.format').value, 'markdown');
  assert.equal($('.fetch').disabled, false);
});

test('the bundle keeps module scopes apart', () => {
  const source = build();
  // Both converters define a renderChildren and a renderNode of their own;
  // flattening them into one scope would be a redeclaration error at parse
  // time. If this premise ever stops holding, find another duplicate rather
  // than deleting the test — it is the only thing checking the bundler.
  for (const name of ['function renderChildren', 'function renderNode']) {
    assert.ok(source.split(name).length > 2, `expected ${name} to still collide`);
  }
  assert.doesNotThrow(() => new Function(source));
});

test('no module syntax survives into the bundle', () => {
  const source = build();
  assert.ok(!/^\s*(?:import|export)\s/m.test(source));
});
