// The service worker decides which world the panel runs in, which is the
// difference between reading the thread and being refused by CORS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

function load({ executeScript }) {
  const calls = [];
  const warnings = [];
  let listener;
  const chrome = {
    action: { onClicked: { addListener: (fn) => { listener = fn; } } },
    scripting: {
      executeScript: async (options) => {
        calls.push(options);
        return executeScript(options, calls.length);
      },
    },
  };
  new Function('chrome', 'console', source)(chrome, {
    warn: (...args) => warnings.push(args.join(' ')),
  });
  return { calls, warnings, click: (tab) => listener(tab) };
}

test('the panel is injected into the page world, not the isolated one', async () => {
  const { calls, click } = load({ executeScript: async () => {} });
  await click({ id: 7, url: 'https://glowfic.com/posts/100' });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { target: { tabId: 7 }, world: 'MAIN', files: ['content.js'] });
});

test('a browser without world support still gets the panel', async () => {
  const { calls, warnings, click } = load({
    executeScript: async (options) => {
      if (options.world) throw new Error('Unsupported option: world');
    },
  });
  await click({ id: 7, url: 'https://glowfic.com/posts/100' });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].world, undefined);
  assert.deepEqual(calls[1], { target: { tabId: 7 }, files: ['content.js'] });
  assert.match(warnings.join('\n'), /main-world injection failed/);
});

test('a page that refuses injection is reported, not thrown', async () => {
  const { warnings, click } = load({
    executeScript: async () => {
      throw new Error('Cannot access a chrome:// URL');
    },
  });

  await assert.doesNotReject(click({ id: 7, url: 'https://glowfic.com/posts/100' }));
  assert.match(warnings.join('\n'), /could not run on this page/);
});

test('a tab with no id is ignored', async () => {
  const { calls, click } = load({ executeScript: async () => {} });
  await click({ url: 'https://glowfic.com/posts/100' });
  assert.equal(calls.length, 0);
});

test('nothing is injected into a page that is not a glowfic thread', async () => {
  const { calls, click } = load({ executeScript: async () => {} });

  for (const url of ['https://example.com/posts/1', 'https://glowfic.com.evil.example/', 'chrome://extensions', '']) {
    await click({ id: 7, url });
  }
  assert.equal(calls.length, 0);
});

test('both glowfic hosts are accepted', async () => {
  const { calls, click } = load({ executeScript: async () => {} });

  await click({ id: 7, url: 'https://glowfic.com/posts/100' });
  await click({ id: 8, url: 'https://www.glowfic.com/posts/100?page=3' });
  assert.equal(calls.length, 2);
});
