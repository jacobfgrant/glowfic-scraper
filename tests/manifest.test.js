// The manifest is the only thing standing between the panel and a blocked
// request, so its permissions are worth asserting rather than eyeballing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(
  readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8')
);

test('the extension can read glowfic.com from an isolated content script', () => {
  assert.deepEqual(manifest.host_permissions, ['https://glowfic.com/*']);
});

test('permissions stay narrow', () => {
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting']);
  // No standing access to anything but glowfic, and nothing that reads history,
  // cookies, or every site.
  for (const granted of [...manifest.permissions, ...manifest.host_permissions]) {
    assert.ok(
      !/^(<all_urls>|\*:\/\/\*\/\*|tabs|cookies|history|webRequest)$/.test(granted),
      `unexpectedly broad permission: ${granted}`
    );
  }
});

test('it is a manifest v3 extension with an action and a background worker', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.ok(manifest.action.default_icon['128']);
  assert.ok(manifest.description.length <= 132, 'store descriptions cap at 132 characters');
});
