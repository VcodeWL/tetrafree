/* Bounded capture with retained ownership after cancellation/timeouts/failure. */
import { spawn } from 'node:child_process'
import { serverProcesses } from './process-safety.mjs'
export async function captureProcess(
  exe,
  args,
  {
    cwd,
    env,
    input = '',
    timeout = 60000,
    signal,
    maxBytes = 2 * 1024 * 1024,
    launch = spawn,
    registry = serverProcesses,
  } = {},
) {
  if (Buffer.byteLength(input) > 2 * 1024 * 1024 || signal?.aborted || !registry.available('git'))
    return { code: -1, out: '', so: '', se: 'Операция отменена или достигнут лимит процессов' }
  const child = launch(exe, args, { cwd, env, detached: process.platform !== 'win32', windowsHide: true })
  const owned = registry.own(child, 'git')
  let so = '',
    se = '',
    bytes = 0,
    failed = false,
    done = false,
    timer
  return new Promise((resolve) => {
    const finish = async (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      const stopped = await owned.stop()
      resolve({
        code: failed ? -1 : code,
        treeStopped: stopped.stopped,
        so,
        se: failed ? 'Операция Git не завершена штатно' : se,
        out: failed ? 'Операция Git не завершена штатно' : so + se,
      })
    }
    const cancel = () => {
      failed = true
      void finish(-1)
    }
    const data = (which) => (d) => {
      if (done) return
      bytes += Buffer.byteLength(d)
      if (bytes > maxBytes) return cancel()
      if (which === 'so') so += d
      else se += d
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', data('so'))
    child.stderr.on('data', data('se'))
    child.stdin.on('error', () => {
      if (input && !done) cancel()
    })
    child.once('error', cancel)
    child.once('close', (code) => {
      void finish(code ?? -1)
    })
    signal?.addEventListener('abort', cancel, { once: true })
    timer = setTimeout(cancel, Math.min(600000, Math.max(1, Number(timeout) || 60000)))
    if (signal?.aborted) cancel()
    if (!done) {
      try {
        if (input) child.stdin.end(input)
        else child.stdin.end()
      } catch {
        cancel()
      }
    }
  })
}
