import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const fixture = fileURLToPath(new URL('./accountAudit.fixture.ts', import.meta.url))
for (const mode of [
  'token-aba',
  'verify-order',
  'verify-stale401',
  'config-order',
  'verify-restores-signin',
  'invite-order',
  'storage-stale-event',
  'proof-publication',
  'reentrant-logout',
  'signin-throws',
  'null-token-expiry',
  'old-logout-reply',
  'logout-reentrant-login',
  'expiry-reentrant-login',
  'vault-provider-snapshot',
  'vault-session-epoch',
  'vault-reauth-replacement',
  'recovery-flight-rotation',
]) {
  test(`new benign actual-source session/vault audit: ${mode}`, () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', fixture, mode], {
      encoding: 'utf8',
      timeout: 10000,
    })
    assert.equal(result.status, 0, `${mode}\n${result.stdout}\n${result.stderr}`)
  })
}
