import test from 'node:test'
import assert from 'node:assert/strict'
import { APP_VERSION } from '../data/changelog'
import {
  collectDiagnostics,
  diagnosticsJSON,
  DIAGNOSTICS_MAX_BYTES,
  DIAGNOSTICS_COUNT_CAP,
  DIAGNOSTICS_BYTES_CAP,
} from './diagnostics'

const secret = 'SYNTHETIC_PRIVATE_marker_no_real_secret'
const observation = () => ({
  utcMillis: Date.UTC(2026, 9, 23),
  store: { hydrated: true, durability: 'verified' },
  backend: { status: 'online', local: true, platform: 'win32', version: 'v3.2.0' },
  projects: { count: 2, fileCount: 9, totalBytes: 1200 },
  automation: {
    paused: false,
    historyCount: 2,
    outcomes: { running: 1, succeeded: 1, failed: 0, cancelled: 0, interrupted: 0, blocked: 0 },
  },
  vault: { blocked: true, pendingCount: 1 },
  sync: {
    backend: 'local',
    disk: 'verified',
    checkpoint: 'confirmed',
    failedFiles: 0,
    conflicts: 0,
    truncated: false,
    canRetry: true,
  },
  checks: { persistence: 'passed', backend: 'passed', sync: 'failed', vault: 'not_checked' },
})
const clone = (value: unknown): unknown => structuredClone(value)

test('metadata positive control; known app constant, normalized versions/platform and explicit checks', () => {
  const d = collectDiagnostics(observation())
  assert.equal(d.appVersion, APP_VERSION)
  assert.equal(d.utc, '2026-10-23T00:00:00.000Z')
  assert.deepEqual(d.store, { hydrated: true, durability: 'verified' })
  assert.deepEqual(d.backend, { status: 'online', local: true, platform: 'windows', version: '3.2.0' })
  assert.deepEqual(d.projects, { count: 2, fileCount: 9, totalBytes: 1200 })
  assert.equal(d.automation.outcomes.succeeded, 1)
  assert.equal(d.checks.sync, 'failed')
})
test('absent/untrusted values never manufacture a healthy zero-count or verified checkpoint', () => {
  for (const raw of [undefined, null, '', 1, Symbol('benign'), [], new Date(), new Error(secret)]) {
    const d = collectDiagnostics(raw)
    assert.equal(d.utc, null)
    assert.equal(d.store.hydrated, null)
    assert.equal(d.store.durability, 'not_checked')
    assert.equal(d.projects.count, null)
    assert.equal(d.vault.pendingCount, null)
    assert.equal(d.backend.status, 'unknown')
    assert.equal(d.checks.persistence, 'not_checked')
  }
  assert.equal(collectDiagnostics({ store: { hydrated: true } }).store.durability, 'not_checked')
  assert.equal(
    collectDiagnostics({ store: { hydrated: false, durability: 'verified' } }).store.durability,
    'not_checked',
  )
})
test('EVERY raw string leaf replaced with synthetic private data stays out of JSON', () => {
  const raw = observation()
  function poison(value: unknown): unknown {
    if (typeof value === 'string') return secret
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, poison(v)]))
    return value
  }
  const json = diagnosticsJSON(poison(raw))
  assert.ok(!json.includes(secret))
  assert.equal(JSON.parse(json).backend.version, 'unknown')
})
test('individual string injection cannot hide in a valid surrounding observation', () => {
  function walk(value: unknown, path: string[] = []): string[][] {
    if (typeof value === 'string') return [path]
    if (!value || typeof value !== 'object') return []
    return Object.entries(value).flatMap(([key, v]) => walk(v, [...path, key]))
  }
  for (const path of walk(observation())) {
    const raw = clone(observation()) as Record<string, unknown>
    let target = raw
    for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>
    target[path[path.length - 1]] = secret
    assert.ok(!diagnosticsJSON(raw).includes(secret), path.join('.'))
  }
})
test('unknown keys and sensitive values at EVERY record level are dropped, never spread', () => {
  const raw = observation()
  function inject(value: unknown) {
    if (!value || typeof value !== 'object') return
    for (const v of Object.values(value)) inject(v)
    Object.assign(value, {
      apiKey: secret,
      token: secret,
      name: secret,
      path: secret,
      prompt: secret,
      files: secret,
      baseUrl: secret,
      error: secret,
      logs: secret,
      userAgent: secret,
      accountScope: secret,
    })
    Object.defineProperty(value, secret, { value: secret, enumerable: true })
  }
  inject(raw)
  assert.ok(!diagnosticsJSON(raw).includes(secret))
  assert.equal(JSON.parse(diagnosticsJSON(raw)).projects.fileCount, 9)
})
test('getters, toJSON, coercion and inherited records never execute or leak', () => {
  let calls = 0
  const hostile = {
    get store() {
      calls++
      throw new Error(secret)
    },
    toJSON() {
      calls++
      return secret
    },
  }
  assert.ok(!diagnosticsJSON(hostile).includes(secret))
  assert.equal(calls, 0)
  const prototype = { store: { hydrated: true }, backend: { version: secret } }
  assert.equal(collectDiagnostics(Object.create(prototype)).store.hydrated, null)
  const data = Object.create(null)
  data.store = Object.assign(Object.create(null), { hydrated: true, durability: 'verified' })
  assert.equal(collectDiagnostics(data).store.durability, 'verified')
  assert.equal(
    collectDiagnostics({
      backend: {
        version: {
          toString() {
            calls++
            return secret
          },
        },
      },
    }).backend.version,
    'unknown',
  )
  assert.equal(calls, 0)
})
test('throwing/revoked proxy exceptions are contained; cycles/huge unknown graphs are not walked', () => {
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  assert.doesNotThrow(() => diagnosticsJSON(proxy))
  const trap = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error(secret)
      },
    },
  )
  assert.ok(!diagnosticsJSON(trap).includes(secret))
  const raw: Record<string, unknown> = { store: { hydrated: true }, huge: secret.repeat(100_000) }
  raw.loop = raw
  assert.equal(collectDiagnostics(raw).store.hydrated, true)
  assert.ok(diagnosticsJSON(raw).length < DIAGNOSTICS_MAX_BYTES)
})
test('finite integer counts only, no string coercion; counts and bytes saturate at explicit caps', () => {
  for (const value of [
    NaN,
    Infinity,
    -Infinity,
    -1,
    1.1,
    Number.MAX_SAFE_INTEGER + 1,
    secret,
    4n,
    {},
    null,
  ]) {
    const d = collectDiagnostics({
      projects: { count: value, fileCount: value, totalBytes: value },
      vault: { pendingCount: value },
      automation: { outcomes: { failed: value } },
    })
    assert.deepEqual(d.projects, { count: null, fileCount: null, totalBytes: null })
    assert.equal(d.vault.pendingCount, null)
    assert.equal(d.automation.outcomes.failed, null)
  }
  const d = collectDiagnostics({
    projects: { count: Number.MAX_SAFE_INTEGER, totalBytes: Number.MAX_SAFE_INTEGER },
  })
  assert.equal(d.projects.count, DIAGNOSTICS_COUNT_CAP)
  assert.equal(d.projects.totalBytes, DIAGNOSTICS_BYTES_CAP)
})
test('platform/status/version are strict; no arbitrary backend string or UA fingerprint', () => {
  for (const value of [
    secret,
    '3.2.0-' + secret,
    '3.2.0/' + secret,
    'Windows NT ' + secret,
    'online ' + secret,
    secret.repeat(100_000),
  ]) {
    const d = collectDiagnostics({
      backend: { status: value, platform: value, version: value, local: value },
    })
    assert.deepEqual(d.backend, { status: 'unknown', platform: 'unknown', version: 'unknown', local: null })
  }
  assert.equal(collectDiagnostics({ backend: { version: '0003.0002.0000' } }).backend.version, '3.2.0')
  assert.equal(collectDiagnostics({ backend: { platform: 'darwin' } }).backend.platform, 'macos')
})
test('optional UTC accepts only bounded epoch milliseconds, not strings or objects', () => {
  for (const utcMillis of [secret, '2026-10-23T00:00:00.000Z', NaN, Infinity, -1, 4133980800000, new Date()])
    assert.equal(collectDiagnostics({ utcMillis }).utc, null)
})
test('serialization has exact allowlisted keys and fixed byte bound; caller override ignored', () => {
  const raw = { ...observation(), schemaVersion: secret, appVersion: secret, toJSON: () => secret }
  const parsed = JSON.parse(diagnosticsJSON(raw))
  assert.deepEqual(Object.keys(parsed), [
    'schemaVersion',
    'appVersion',
    'utc',
    'limits',
    'store',
    'backend',
    'projects',
    'automation',
    'vault',
    'sync',
    'checks',
  ])
  assert.deepEqual(Object.keys(parsed.backend), ['status', 'local', 'platform', 'version'])
  assert.deepEqual(Object.keys(parsed.automation.outcomes), [
    'running',
    'succeeded',
    'failed',
    'cancelled',
    'interrupted',
    'blocked',
  ])
  assert.deepEqual(Object.keys(parsed.checks), ['persistence', 'backend', 'sync', 'vault'])
  const max = {
    utcMillis: 4133980799999,
    backend: { version: '9999.9999.9999' },
    projects: { count: Number.MAX_SAFE_INTEGER, totalBytes: Number.MAX_SAFE_INTEGER },
  }
  for (const input of [raw, max, {}, secret, null])
    assert.ok(Buffer.byteLength(diagnosticsJSON(input), 'utf8') <= DIAGNOSTICS_MAX_BYTES)
  assert.equal(parsed.appVersion, APP_VERSION)
})

test('captureSyncHealth input exports ONLY selected enums/counts/flags, NEVER project ID/time/context', () => {
  const raw = {
    sync: {
      projectId: secret,
      lastDiskCheckAt: Date.UTC(2026, 9, 23),
      backend: 'local',
      disk: 'verified',
      checkpoint: 'confirmed',
      failedFiles: 2,
      conflicts: 1,
      truncated: true,
      canRetry: false,
      path: secret,
      token: secret,
      context: { accountId: secret },
    },
  }
  const result = collectDiagnostics(raw)
  assert.deepEqual(result.sync, {
    backend: 'local',
    disk: 'verified',
    checkpoint: 'confirmed',
    failedFiles: 2,
    conflicts: 1,
    truncated: true,
    canRetry: false,
  })
  const json = diagnosticsJSON(raw)
  for (const forbidden of [secret, 'projectId', 'lastDiskCheckAt', 'accountId', 'context'])
    assert.ok(!json.includes(forbidden))
  assert.equal(result.store.durability, 'not_checked')
  assert.equal(result.checks.sync, 'not_checked')
})
