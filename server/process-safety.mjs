import { spawn } from 'node:child_process'

export function childEnv(extra = {}, source = process.env) {
  const env = { ...source }
  for (const k of Object.keys(env))
    if (
      /^(SMTP_URL|MAIL_FROM|APP_URL|TF_(DATA|ROOT|ALLOWED_HOSTS|SERVE|RATE_MULT)|(?:GITHUB|GOOGLE)_CLIENT_(SECRET|ID)|GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|EXEC_PATH))$/i.test(
        k,
      )
    )
      delete env[k]
  // Explicit project/MCP environment is deliberate, unlike inherited server credentials.
  return { ...env, ...extra }
}
// Best-effort tree ownership, NOT an OS sandbox. Failure is explicit and retained.
const closedChildren = new WeakSet()
const unresolvedClosedWindows = new WeakSet()
export function observeChild(child) {
  child.once?.('close', () => closedChildren.add(child))
  return child
}
export async function killTree(
  child,
  signal = 'SIGTERM',
  platform = process.platform,
  launch = spawn,
  options = {},
) {
  const grace = options.grace ?? 700,
    deadline = options.deadline ?? 1500
  const groupKill = options.groupKill ?? process.kill
  if (!child?.pid) return { stopped: true, reason: 'not-started' }
  const fallback = (sig) => {
    try {
      child.kill?.(sig)
    } catch {
      /* retained below */
    }
  }
  if (platform === 'win32') {
    // A later retry cannot safely address a dead root by numeric PID: Windows
    // may have reused it. Retain orphan ownership for the app Job shutdown.
    if (unresolvedClosedWindows.has(child))
      return { stopped: false, reason: 'native-tree-ownership-required' }
    return new Promise((resolve) => {
      let task,
        timer,
        done = false,
        treeOK = false
      const finish = (ok) => {
        if (done) return
        done = true
        clearTimeout(timer)
        child.removeListener?.('close', onClose)
        if (!ok) {
          if (closedChildren.has(child)) unresolvedClosedWindows.add(child)
          else {
            try {
              child.kill?.('SIGKILL')
            } catch {
              /* retained */
            }
          }
        }
        resolve({
          stopped: ok && closedChildren.has(child),
          reason: ok ? 'tree-stop-requested' : 'tree-stop-failed',
        })
      }
      const onClose = () => {
        if (treeOK) finish(true)
      }
      const taskDone = (code) => {
        if (code !== 0) finish(false)
        else {
          treeOK = true
          if (closedChildren.has(child)) finish(true)
        }
      }
      child.once?.('close', onClose)
      try {
        task = launch('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
          env: childEnv(),
        })
        task.once('error', () => finish(false))
        task.once('exit', taskDone)
        task.once('close', taskDone)
        timer = setTimeout(() => {
          try {
            task.kill()
          } catch {
            /* deadline */
          }
          finish(false)
        }, deadline)
        task.unref?.()
      } catch {
        finish(false)
      }
    })
  }
  const absent = () => {
    try {
      groupKill(-child.pid, 0)
      return false
    } catch (e) {
      return e.code === 'ESRCH'
    }
  }
  const send = (sig) => {
    try {
      groupKill(-child.pid, sig)
    } catch (e) {
      if (e.code !== 'ESRCH') fallback(sig)
    }
  }
  send(signal)
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = Date.now() + deadline
  while (Date.now() < until) {
    if (absent() && closedChildren.has(child)) return { stopped: true, reason: 'reaped' }
    if (Date.now() >= until - deadline + grace) {
      send('SIGKILL')
      break
    }
    await wait(Math.min(25, grace))
  }
  while (Date.now() < until) {
    if (absent() && closedChildren.has(child)) return { stopped: true, reason: 'reaped' }
    await wait(25)
  }
  return { stopped: absent() && closedChildren.has(child), reason: 'tree-stop-unconfirmed' }
}

export function createProcessRegistry({
  limit = 64,
  stop = killTree,
  historyLimit = 64,
  kindLimits = { git: 8, browser: 4, exec: 32, mcp: 8, pty: 12 },
} = {}) {
  limit = Math.min(1024, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 64))
  historyLimit = Math.min(1024, Math.max(0, Number.isFinite(historyLimit) ? Math.floor(historyLimit) : 64))
  const entries = new Map(),
    recentClosed = []
  // Closed root PIDs must not be reused as kill targets. Lifetime obligations
  // are summarized in fixed memory, not falsely called confirmed tree stops.
  // In the Windows desktop the enclosing Rust Job owns residual descendants;
  // standalone Node cannot guarantee their cancellation/termination.
  const closedRootObligations = { total: 0, exec: 0, git: 0, browser: 0, mcp: 0, process: 0 }
  let shuttingDown = false
  const available = (kind) =>
    !shuttingDown &&
    entries.size < limit &&
    (!kindLimits[kind] || [...entries.values()].filter((e) => e.kind === kind).length < kindLimits[kind])
  const own = (child, kind = 'process', cleanup = () => {}) => {
    if (!available(kind)) throw new Error('Лимит дочерних процессов')
    if (entries.has(child)) throw new Error('Процесс уже зарегистрирован')
    observeChild(child)
    const entry = {
      child,
      kind,
      orphan: false,
      rootClosed: false,
      stopping: null,
      cleanup,
      retired: false,
      lastResult: null,
    }
    entries.set(child, entry)
    const retire = async (result) => {
      entries.delete(child)
      entry.retired = true
      entry.lastResult = result
      if (!result.stopped) {
        const bucket = Object.hasOwn(closedRootObligations, kind) && kind !== 'total' ? kind : 'process'
        closedRootObligations.total = Math.min(Number.MAX_SAFE_INTEGER, closedRootObligations.total + 1)
        closedRootObligations[bucket] = Math.min(Number.MAX_SAFE_INTEGER, closedRootObligations[bucket] + 1)
        recentClosed.push({ kind: bucket, at: Date.now(), treeStopped: false })
        while (recentClosed.length > historyLimit) recentClosed.shift()
      }
      // Only own operation resources (e.g. generated temporary scripts/profile,
      // protocol buffers). Root close permits best-effort release of these, NOT
      // a claim that descendants exited. Never user-project cleanup here.
      try {
        await cleanup({ treeStopped: result.stopped, rootClosed: entry.rootClosed })
      } catch {
        /* best-effort own-resource cleanup */
      }
      entry.cleanup = null
    }
    const halt = () => {
      if (entry.stopping) return entry.stopping
      if (entry.retired) return Promise.resolve(entry.lastResult)
      entry.stopping = Promise.resolve()
        .then(() => stop(child))
        .catch(() => ({ stopped: false }))
        .then(async (result) => {
          entry.orphan = !result.stopped
          if (result.stopped || entry.rootClosed) await retire(result)
          entry.stopping = null
          return result
        })
      return entry.stopping
    }
    entry.stop = halt
    child.once('close', () => {
      entry.rootClosed = true
      void halt()
    })
    return entry
  }
  return {
    entries,
    closedRootObligations,
    recentClosed,
    available,
    own,
    async shutdown() {
      shuttingDown = true
      return Promise.all([...entries.values()].map((e) => e.stop()))
    },
  }
}
export const serverProcesses = createProcessRegistry()

export function winScripts(command, marker) {
  // Separate user batch prevents early %CD%/%ERRORLEVEL% expansion. Delayed
  // expansion stays disabled, so literal ! in paths/commands remains intact.
  return {
    command: command.replace(/\r?\n/g, '\r\n') + '\r\n',
    wrapper: `@echo off\r\nchcp 65001 >nul\r\ncall "%TF_EXEC_COMMAND%"\r\nset "TF_EXEC_STATUS=%ERRORLEVEL%"\r\necho.\r\necho ${marker}%CD%\r\nexit /b %TF_EXEC_STATUS%\r\n`,
  }
}
export function boundedSend(res, stop, max = 256 * 1024) {
  let failed = false
  return (obj) => {
    if (failed || res.destroyed || res.writableEnded) return false
    const line = JSON.stringify(obj) + '\n'
    if ((res.writableLength || 0) + Buffer.byteLength(line) > max) {
      failed = true
      stop()
      res.destroy()
      return false
    }
    try {
      return res.write(line)
    } catch {
      failed = true
      stop()
      return false
    }
  }
}

/** Bounded sidecar parent-control channel, never exposed as an HTTP route. */
export function parentControl(input, shutdown) {
  let buf = '',
    closing = false
  const stop = () => {
    if (!closing) {
      closing = true
      void shutdown()
    }
  }
  input.setEncoding('utf8')
  input.on('data', (text) => {
    buf += text
    if (buf.length > 8192) {
      buf = ''
      return
    }
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      try {
        if (JSON.parse(line)?.type === 'tetra-shutdown') stop()
      } catch {
        /* unknown parent record */
      }
    }
  })
  input.on('end', stop)
  input.on('error', stop)
}
