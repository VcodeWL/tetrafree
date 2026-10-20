import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const fixture = fileURLToPath(new URL('./vaultOutbox.fixture.ts', import.meta.url))
function run(dir: string, phase: string) {
  const p = spawnSync(process.execPath, ['--import', 'tsx', fixture, dir, phase], {
    encoding: 'utf8',
    timeout: 12000,
  })
  assert.equal(p.status, 0, `${phase}: ${p.stdout}\n${p.stderr}`)
  const lines = p.stdout.trim().split('\n')
  return JSON.parse(lines[lines.length - 1])
}
for (const phase of ['failed-delete', 'stale-snapshot', 'removed'])
  test(`${phase} -> real fresh process retries delete without restoring old key`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'tf-vault-'))
    try {
      run(dir, phase)
      const out = run(dir, 'reload')
      assert.equal(out.sets, 0)
      assert.equal(out.deletes, 1)
      run(dir, 'reload')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
test('failed DELETE survives repeated process exits and token rotation; backend/account intents isolated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tf-vault-'))
  const copy = dir + '-copy'
  try {
    run(dir, 'failed-delete')
    run(dir, 'reload-failed')
    for (const phase of ['rotate-token', 'account-B', 'backend-B']) {
      cpSync(dir, copy, { recursive: true })
      const out = run(copy, phase)
      assert.equal(out.deletes, phase === 'rotate-token' ? 1 : 0)
      rmSync(copy, { recursive: true })
    }
    run(dir, 'reload')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(copy, { recursive: true, force: true })
  }
})
for (const phase of [
  'quota',
  'anonymous',
  'aba',
  'late-delete',
  'late-account',
  'late-backend',
  'corrupt',
  'ack-quota',
])
  test(`actual settings/vault failclosed regression: ${phase}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'tf-vault-'))
    try {
      run(dir, phase)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

test('replacement durable checkpoint proof survives failed SET and reload without losing new key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tf-vault-'))
  try {
    run(dir, 'replacement-fail')
    run(dir, 'replacement-reload')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

for (const phase of [
  'startup-unknown',
  'startup-durability-fail',
  'startup-recover',
  'startup-login',
  'startup-token-only',
])
  test(`strict startup gate: ${phase}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'tf-vault-'))
    try {
      run(dir, 'stale-snapshot')
      run(dir, phase)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
