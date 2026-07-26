// Builds the real bundle and runs it in a page, because a syntax check does not
// catch modules colliding once their scopes are flattened together.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = readFileSync(new URL('./fixtures/thread-page.html', import.meta.url), 'utf8');

const POST = {
  id: 100,
  subject: 'New neighbors. Just as frustrating.',
  description: 'Mountain and Elves',
  num_replies: 369,
  board: { id: 3, name: 'Sandboxes' },
  authors: [{ username: 'lintamande' }, { username: 'Rockeye' }],
  character: { id: 588, name: 'Mountain' },
  icon: { keyword: 'confusion' },
  content: '<p>She does not feel any tiles.</p>',
};

function build() {
  const result = spawnSync('python3', ['build.py'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `build.py failed:\n${result.stderr}`);
  return readFileSync(new URL('../dist/bookmarklet.js', import.meta.url), 'utf8');
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

  const host = dom.window.document.getElementById('glowfic-clean-export');
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
  // Two modules declare a HEADINGS of their own; flattening them into one
  // scope would be a redeclaration error at parse time.
  assert.ok(source.split('const HEADINGS').length > 2, 'expected the collision to still exist');
  assert.doesNotThrow(() => new Function(source));
});

test('no module syntax survives into the bundle', () => {
  const source = build();
  assert.ok(!/^\s*(?:import|export)\s/m.test(source));
});
