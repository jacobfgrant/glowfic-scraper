// The manifest is the only thing standing between the panel and a blocked
// request, so its permissions are worth asserting rather than eyeballing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(
  readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8')
);

test('no host permissions are needed, because requests are same-origin', () => {
  // The panel calls the API on whichever origin the reader is already on, so
  // the extension never makes a cross-origin request and Chrome shows no
  // "read your data on..." warning.
  assert.equal(manifest.host_permissions, undefined);
});

test('permissions stay narrow', () => {
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting']);
  for (const granted of manifest.permissions) {
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
