import type { ReplaceReply, ReplaceRequest } from './replace'

export const REPLACE_BUDGET_MS = 1500
export interface ReplaceWorker {
  postMessage: (request: ReplaceRequest) => void
  terminate: () => void
  onmessage: ((event: MessageEvent<ReplaceReply>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

/** A fresh worker per operation: terminate interrupts even one non-returning RegExp.exec. */
export function replaceJob(
  request: ReplaceRequest,
  factory: () => ReplaceWorker,
  budget = REPLACE_BUDGET_MS,
) {
  let cancel = () => {}
  const promise = new Promise<Extract<ReplaceReply, { ok: true }>>((resolve, reject) => {
    let worker: ReplaceWorker
    try {
      worker = factory()
    } catch {
      reject(new Error('Не удалось запустить безопасный поиск'))
      return
    }
    let done = false
    const finish = (reply: ReplaceReply) => {
      if (done) return
      done = true
      clearTimeout(timer)
      worker.onmessage = worker.onerror = null
      worker.terminate()
      if (reply.ok) resolve(reply)
      else reject(new Error(reply.error))
    }
    const timer = setTimeout(
      () => finish({ ok: false, error: 'Поиск остановлен: превышен лимит времени. Упрости выражение.' }),
      budget,
    )
    cancel = () => finish({ ok: false, error: 'Поиск отменён' })
    worker.onmessage = (event) => finish(event.data)
    worker.onerror = () => finish({ ok: false, error: 'Не удалось выполнить безопасный поиск' })
    try {
      worker.postMessage(request)
    } catch {
      finish({ ok: false, error: 'Не удалось передать файлы в безопасный поиск' })
    }
  })
  return { promise, cancel }
}
