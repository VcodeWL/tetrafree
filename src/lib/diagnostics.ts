/* Local metadata only. No state traversal, coercion, getters, toJSON, I/O or health checks. */
import { APP_VERSION } from '../data/changelog'

export const DIAGNOSTICS_MAX_BYTES = 4096
export const DIAGNOSTICS_COUNT_CAP = 1_000_000
export const DIAGNOSTICS_BYTES_CAP = 1_000_000_000_000
const OUTCOMES = ['running', 'succeeded', 'failed', 'cancelled', 'interrupted', 'blocked'] as const
const CHECKS = ['persistence', 'backend', 'sync', 'vault'] as const

/** Own data properties of plain records only. Never invoke a user-supplied getter/toJSON. */
function field(raw: unknown, key: string): unknown {
  try {
    if (!raw || typeof raw !== 'object') return undefined
    const proto = Object.getPrototypeOf(raw)
    if (proto !== null && proto !== Object.prototype) return undefined
    const descriptor = Object.getOwnPropertyDescriptor(raw, key)
    return descriptor && 'value' in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}
function choice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback
}
function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}
function count(value: unknown, cap = DIAGNOSTICS_COUNT_CAP): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? Math.min(value, cap) : null
}
function version(value: unknown): string {
  if (typeof value !== 'string' || value.length > 15 || !/^v?\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value))
    return 'unknown'
  return value.replace(/^v/, '').split('.').map(Number).join('.')
}
function platform(value: unknown): 'windows' | 'linux' | 'macos' | 'web' | 'unknown' {
  if (value === 'win32' || value === 'windows' || value === 'win') return 'windows'
  if (value === 'darwin' || value === 'macos' || value === 'mac') return 'macos'
  if (value === 'linux') return 'linux'
  return value === 'web' ? 'web' : 'unknown'
}

/** Parent supplies already-aggregated observations, NOT raw store/projects/files/outbox entries.
 * Unknown/missing values stay unknown. "verified" must come from a real checkpoint observation;
 * hydration alone is never evidence of durability. Counts are saturating, not exact above caps.
 */
export function collectDiagnostics(raw: unknown = {}) {
  const store = field(raw, 'store'),
    backend = field(raw, 'backend'),
    projects = field(raw, 'projects')
  const automation = field(raw, 'automation'),
    vault = field(raw, 'vault'),
    checks = field(raw, 'checks')
  const outcomes = field(automation, 'outcomes')
  const sync = field(raw, 'sync')
  const hydrated = bool(field(store, 'hydrated'))
  const millis = field(raw, 'utcMillis')
  const utc =
    typeof millis === 'number' &&
    Number.isSafeInteger(millis) &&
    millis >= 946684800000 &&
    millis < 4133980800000
      ? new Date(millis).toISOString()
      : null
  return {
    schemaVersion: 1,
    appVersion: version(APP_VERSION),
    utc,
    limits: { count: DIAGNOSTICS_COUNT_CAP, bytes: DIAGNOSTICS_BYTES_CAP },
    store: {
      hydrated,
      durability: hydrated === true && field(store, 'durability') === 'verified' ? 'verified' : 'not_checked',
    },
    backend: {
      status: choice(field(backend, 'status'), ['online', 'offline', 'checking', 'unknown'], 'unknown'),
      local: bool(field(backend, 'local')),
      platform: platform(field(backend, 'platform')),
      version: version(field(backend, 'version')),
    },
    projects: {
      count: count(field(projects, 'count')),
      fileCount: count(field(projects, 'fileCount')),
      totalBytes: count(field(projects, 'totalBytes'), DIAGNOSTICS_BYTES_CAP),
    },
    automation: {
      paused: bool(field(automation, 'paused')),
      historyCount: count(field(automation, 'historyCount')),
      outcomes: Object.fromEntries(OUTCOMES.map((key) => [key, count(field(outcomes, key))])),
    },
    vault: {
      blocked: bool(field(vault, 'blocked')),
      pendingCount: count(field(vault, 'pendingCount')),
    },
    sync: {
      backend: choice(
        field(sync, 'backend'),
        ['checking', 'offline', 'remote', 'signed-out', 'local', 'unknown'],
        'unknown',
      ),
      disk: choice(
        field(sync, 'disk'),
        [
          'no-project',
          'unavailable',
          'disabled',
          'unchecked',
          'checking',
          'pending',
          'partial',
          'error',
          'verified',
          'unknown',
        ],
        'unknown',
      ),
      checkpoint: choice(
        field(sync, 'checkpoint'),
        ['unconfirmed', 'pending', 'confirmed', 'failed', 'unknown'],
        'unknown',
      ),
      failedFiles: count(field(sync, 'failedFiles')),
      conflicts: count(field(sync, 'conflicts')),
      truncated: bool(field(sync, 'truncated')),
      canRetry: bool(field(sync, 'canRetry')),
    },
    checks: Object.fromEntries(
      CHECKS.map((key) => [
        key,
        choice(field(checks, key), ['passed', 'failed', 'not_checked'], 'not_checked'),
      ]),
    ),
  }
}

/** Always rebuild from unknown input. Never stringify a caller-supplied "sanitized" object. */
export function diagnosticsJSON(raw: unknown = {}): string {
  const json = JSON.stringify(collectDiagnostics(raw), null, 2)
  // All emitted strings are fixed ASCII enums, normalized digits or UTC, so bytes === length.
  if (json.length > DIAGNOSTICS_MAX_BYTES) throw new Error('Diagnostics schema exceeds export limit')
  return json
}
