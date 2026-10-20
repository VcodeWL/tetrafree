/** Token-scoped native close checkpoint; testable without Tauri/DOM/store imports. */
export type CheckpointRequest = { token: string; reason: 'quit' | 'hide' | 'update'; timeoutMs: number }
export interface CheckpointDependencies {
  flush: () => Promise<void>
  ack: (token: string, saved: boolean) => Promise<unknown>
  warn: () => void
  now?: () => number
}
/** Conservative checkpoint: do not authorize exit if a writer changed the store
 * while durable persistence was awaiting I/O. This is a point-in-time guard,
 * not a claim that background writers are frozen after the ACK. */
export async function flushStableCheckpoint(flush: () => Promise<void>, revision: () => number) {
  const before = revision()
  await flush()
  if (revision() !== before) throw new Error('Состояние изменилось во время сохранения; повтори попытку')
}
export function createCheckpointHandler(deps: CheckpointDependencies) {
  const seen = new Set<string>()
  let busy = false
  return async (request: CheckpointRequest) => {
    if (
      !request ||
      !/^[a-f0-9]{64}$/.test(request.token) ||
      !['quit', 'hide', 'update'].includes(request.reason) ||
      !Number.isInteger(request.timeoutMs) ||
      request.timeoutMs < 1 ||
      request.timeoutMs > 8000
    )
      return
    if (seen.has(request.token)) return
    seen.add(request.token)
    while (seen.size > 64) seen.delete(seen.values().next().value!)
    if (busy) {
      await deps.ack(request.token, false).catch(() => {})
      return
    }
    busy = true
    const now = deps.now || Date.now,
      deadline = now() + request.timeoutMs
    let timer: ReturnType<typeof setTimeout> | undefined
    let saved = false
    try {
      await Promise.race([
        deps.flush(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('checkpoint deadline')), request.timeoutMs)
        }),
      ])
      saved = now() < deadline
    } catch {
      /* never ACK success on failure/deadline */
    } finally {
      clearTimeout(timer)
    }
    let ackTimer: ReturnType<typeof setTimeout> | undefined
    try {
      const accepted = await Promise.race([
        deps.ack(request.token, saved),
        new Promise<never>((_, reject) => {
          ackTimer = setTimeout(() => reject(new Error('ACK deadline')), 1000)
        }),
      ])
      if (accepted === false) saved = false
    } catch {
      saved = false
    } finally {
      clearTimeout(ackTimer)
      busy = false
    }
    if (!saved) deps.warn()
  }
}

let generation = 0
/** Parent: useEffect(() => startDesktopLifecycle(), []). Browser is a no-op. */
export function startDesktopLifecycle(): () => void {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return () => {}
  const current = ++generation
  let disposed = false
  const cleanups: (() => void)[] = []
  let warnedAt = 0
  const warn = () => {
    if (disposed || Date.now() - warnedAt < 1000) return
    warnedAt = Date.now()
    void import('../store')
      .then(({ useStore }) =>
        useStore.getState().toast({
          title: 'Сохранение не подтверждено',
          desc: 'Приложение оставлено открытым. Повтори попытку, освободи место или экспортируй данные.',
          icon: 'warn',
          tone: 'err',
        }),
      )
      .catch(() => {})
  }
  void (async () => {
    const { listen } = await import('@tauri-apps/api/event')
    const { invoke } = await import('@tauri-apps/api/core')
    const handler = createCheckpointHandler({
      flush: async () => {
        const persistence = await import('../store/persistence')
        await flushStableCheckpoint(
          persistence.flushPersistence,
          persistence.capturePersistenceRuntimeRevision,
        )
      },
      ack: (token, saved) => invoke('desktop_checkpoint_ack', { token, saved }),
      warn,
    })
    const checkpoint = await listen<CheckpointRequest>('desktop-checkpoint', (event) => {
      void handler(event.payload)
    })
    if (disposed || current !== generation) {
      checkpoint()
      return
    }
    cleanups.push(checkpoint)
    const warning = await listen('desktop-checkpoint-failed', warn)
    if (disposed || current !== generation) {
      warning()
      return
    }
    cleanups.push(warning)
    await invoke('desktop_checkpoint_ready', { ready: true })
  })().catch(warn)
  return () => {
    disposed = true
    cleanups.splice(0).forEach((cleanup) => cleanup())
    if (current === generation)
      void import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('desktop_checkpoint_ready', { ready: false }))
        .catch(() => {})
  }
}
