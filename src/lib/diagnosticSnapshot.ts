/** Read-only observations. The export boundary is the strict diagnostics allowlist. */
import { useStore } from '../store'
import { useBackend } from './backend'
import { captureSyncHealth } from './syncStatus'
import { vaultStartupBlocked } from './vault'
import { useAutomationControl } from '../agent/automationControl'
import { useAutomationJournal } from '../agent/automationJournal'

export function captureDiagnostics() {
  const s = useStore.getState()
  const b = useBackend.getState()
  const journal = useAutomationJournal.getState()
  const cap = 1_000_000
  let fileCount = 0
  for (const p of s.projects) {
    for (const key in p.files) {
      if (!Object.prototype.hasOwnProperty.call(p.files, key)) continue
      fileCount++
      if (fileCount >= cap) break
    }
    if (fileCount >= cap) break
  }
  const outcomes = { running: 0, succeeded: 0, failed: 0, cancelled: 0, interrupted: 0, blocked: 0 }
  if (!journal.unavailable) for (const run of journal.runs) outcomes[run.outcome]++
  const h = captureSyncHealth()
  return {
    utcMillis: Date.now(),
    store: { hydrated: useStore.persist.hasHydrated(), durability: 'not_checked' },
    backend: { status: b.status, local: b.info?.local, platform: b.info?.platform, version: b.info?.version },
    projects: { count: s.projects.length, fileCount },
    automation: {
      paused: useAutomationControl.getState().paused,
      ...(journal.unavailable ? {} : { historyCount: journal.runs.length, outcomes }),
    },
    vault: { blocked: vaultStartupBlocked() },
    sync: {
      backend: h.backend,
      disk: h.disk,
      checkpoint: h.checkpoint,
      failedFiles: h.failedFiles,
      conflicts: h.conflicts,
      truncated: h.truncated,
      canRetry: h.canRetry,
    },
  }
}
