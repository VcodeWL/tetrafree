/* Required production-shell checks; optional diagnostics never change the gate. */
import { spawn, execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WIN_SHELL } from '../server/pty.mjs'

const children = new Set()
const spawnTracked = (...args) => {
  const child = spawn(...args)
  children.add(child)
  child.once('close', () => children.delete(child))
  return child
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
export const terminalText = (text) =>
  text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][0-2A-Z]/g, '')
    .replace(/\r/g, '\n')
export function hasOutputRecord(output, expected) {
  return terminalText(output)
    .split('\n')
    .some((line) => line.trim() === expected)
}

async function killTree(p) {
  if (!p.pid || p.exitCode !== null || p.signalCode !== null) return
  await new Promise((resolve) =>
    execFile('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () =>
      resolve(),
    ),
  )
  p.kill()
  if (p.exitCode === null && p.signalCode === null)
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000)
      p.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
    })
}

/* Exported so the exact smoke assertions can be regression-tested with an echo-only helper. */
export async function probeTerminal(
  p,
  {
    command,
    expected,
    resizeCommand = command,
    exitCommand = 'exit 0\r',
    expectedExit = 0,
    checkUtf = true,
    timeout = 15000,
    rows = 37,
    cols = 113,
  },
) {
  let output = '',
    stderr = '',
    closed = false,
    exit = null,
    failure = null
  p.stdout.setEncoding('utf8')
  p.stderr.setEncoding('utf8')
  p.stdout.on('data', (d) => {
    output = (output + d).slice(-128 * 1024)
  })
  p.stderr.on('data', (d) => {
    stderr = (stderr + d).slice(-4096)
  })
  p.stdin.on('error', (e) => {
    failure = e
  })
  p.on('error', (e) => {
    failure = e
  })
  p.on('close', (code) => {
    closed = true
    exit = code
  })
  const waitFor = async (check, label) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (failure) throw failure
      if (check()) return
      if (closed) break
      await sleep(50)
    }
    throw new Error(`${label}; exit=${exit}; stdout=${JSON.stringify(output.slice(-1000))}; stderr=${stderr}`)
  }
  try {
    await waitFor(() => />\s*$/.test(terminalText(output)), 'shell prompt missing')
    p.stdin.write(command)
    await waitFor(
      () => hasOutputRecord(output, expected),
      'executed output missing (input echo is not output)',
    )
    if (checkUtf)
      await waitFor(() => hasOutputRecord(output, 'TFUTF:Привет'), 'UTF-8 Cyrillic output missing')
    await waitFor(() => hasOutputRecord(output, 'TFSIZE:80x24'), 'initial console dimensions missing')
    output = ''
    p.stdin.write(`\0TFRSZ ${cols} ${rows}\n`)
    await sleep(200)
    p.stdin.write(resizeCommand)
    await waitFor(
      () => hasOutputRecord(output, `TFSIZE:${cols}x${rows}`),
      'resize not observed by console process',
    )
    p.stdin.write(exitCommand)
    await waitFor(() => closed, 'shell exit timeout')
    assert(exit === expectedExit, `expected exit ${expectedExit}, got ${exit}`)
  } finally {
    await killTree(p)
  }
}

const PROBE_CS = String.raw`
using System;
using System.Runtime.InteropServices;
class ConsoleProbe {
  [StructLayout(LayoutKind.Sequential)] struct COORD { public short X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct RECT { public short Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct INFO { public COORD Size, Cursor; public short Attributes; public RECT Window; public COORD Max; }
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetConsoleScreenBufferInfo(IntPtr h, out INFO info);
  static int Main(string[] args) {
    INFO info;
    if (args.Length != 2 || !GetConsoleScreenBufferInfo(GetStdHandle(-11), out info)) return 9;
    Console.WriteLine("TFEXEC:" + args[0] + args[1]);
    Console.WriteLine("TFSIZE:" + info.Size.X + "x" + info.Size.Y);
    Console.WriteLine("TFUTF:" + (char)1055 + (char)1088 + (char)1080 + (char)1074 + (char)1077 + (char)1090);
    return 0;
  }
}`

async function compileProbe(dir) {
  const { ensureConPty } = await import('../server/conpty-win.mjs')
  const helper = await ensureConPty()
  const source = path.join(dir, 'console-probe.cs'),
    exe = path.join(dir, 'console-probe.exe')
  fs.writeFileSync(source, PROBE_CS)
  const csc = ['Framework64', 'Framework']
    .map((f) => path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', f, 'v4.0.30319', 'csc.exe'))
    .find(fs.existsSync)
  assert(csc, 'csc.exe missing')
  await new Promise((resolve, reject) =>
    execFile(
      csc,
      ['/nologo', '/target:exe', `/out:${exe}`, source],
      { timeout: 60000, windowsHide: true },
      (error, stdout, stderr) =>
        error ? reject(new Error(`console probe compile: ${stdout} ${stderr}`)) : resolve(),
    ),
  )
  return { helper, exe }
}

async function run() {
  if (process.platform !== 'win32') {
    console.log('smoke-win: SKIP (not Windows; no native pass)')
    return
  }
  const results = []
  const step = async (name, fn, required = true) => {
    const start = Date.now()
    try {
      await fn()
      results.push({ name, pass: true, required })
      console.log(`ok ${name} (${Date.now() - start}ms)`)
    } catch (e) {
      results.push({ name, pass: false, required })
      console.error(`${required ? 'FAIL' : 'INFO failure'} ${name}: ${e.stack || e}`)
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-smoke-'))
  const watchdog = setTimeout(async () => {
    console.error('smoke-win: overall deadline exceeded')
    await Promise.all([...children].map(killTree))
    process.exit(1)
  }, 240000)
  try {
    let binaries
    await step('compile ConPTY and native console size probe', async () => {
      binaries = await compileProbe(dir)
    })
    if (binaries)
      for (const [label, shell, ps] of [
        ['PowerShell 5.1 (production)', WIN_SHELL, true],
        ['cmd', 'cmd.exe /d /q', false],
      ]) {
        await step(`${label}: execute vs echo, UTF-8, resize, expected exit`, async () => {
          const a = randomBytes(6).toString('hex'),
            b = randomBytes(6).toString('hex')
          const command = `${ps ? '& ' : ''}"${binaries.exe}" ${a} ${b}\r`
          const child = spawnTracked(binaries.helper, ['80', '24', shell], {
            windowsHide: true,
            env: { ...process.env, TF_PTY_DEBUG: '1' },
          })
          await probeTerminal(child, {
            command,
            expected: `TFEXEC:${a}${b}`,
            expectedExit: 23,
            exitCommand: ps ? 'exit 23\r' : 'exit /b 23\r',
          })
        })
      }
    await step('ConPTY: full 32-bit exit (256)', async () => {
      assert(binaries, 'helper compilation failed')
      const child = spawnTracked(binaries.helper, ['80', '24', 'cmd.exe /d /c exit 256'], {
        windowsHide: true,
      })
      child.stdout.resume()
      child.stderr.resume()
      try {
        const code = await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('exit256 timeout')), 15000)
          child.once('error', (e) => {
            clearTimeout(t)
            reject(e)
          })
          child.once('close', (c) => {
            clearTimeout(t)
            resolve(c)
          })
        })
        assert(code === 256, `Windows exit256 became ${code}`)
      } finally {
        await killTree(child)
      }
    })
    await step('DPAPI vault round trip', async () => {
      const { createVault } = await import('../server/secrets.mjs')
      const vaultDir = path.join(dir, 'vault'),
        secret = 'sk-test-' + randomBytes(12).toString('hex')
      const v = createVault({ dir: vaultDir, win: true })
      assert(v.mode === 'dpapi', `vault mode=${v.mode}`)
      await v.set('openai', secret)
      assert(
        !fs.readFileSync(path.join(vaultDir, 'secrets.json'), 'utf8').includes(secret),
        'plaintext secret',
      )
      const again = createVault({ dir: vaultDir, win: true })
      assert((await again.list()).openai === secret, 'roundtrip mismatch')
      await again.remove('openai')
      assert(!('openai' in (await again.list())), 'secret not removed')
    })
    await step('backend TF_SERVE: authenticated PTY API and graceful shutdown', async () => {
      const port = 3900 + Math.floor(Math.random() * 90)
      const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
      const home = path.join(dir, 'home')
      fs.mkdirSync(home)
      const env = {
        ...process.env,
        PORT: String(port),
        USERPROFILE: home,
        HOME: home,
        TF_SERVE: '1',
        TF_DATA: path.join(home, 'data'),
        TF_ROOT: path.join(home, 'projects'),
      }
      for (const key of [
        'SMTP_URL',
        'GITHUB_CLIENT_ID',
        'GITHUB_CLIENT_SECRET',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'TETRA_WIN_SHELL',
      ])
        delete env[key]
      const child = spawnTracked(process.execPath, [path.join(root, 'server/tetra-server.mjs')], {
        windowsHide: true,
        env,
      })
      let log = '',
        error
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding('utf8')
        stream.on('data', (d) => {
          log = (log + d).slice(-4096)
        })
      }
      child.on('error', (e) => {
        error = e
      })
      try {
        const end = Date.now() + 30000
        let health
        while (Date.now() < end) {
          if (error) throw error
          try {
            const r = await fetch(`http://127.0.0.1:${port}/api/health`, {
              signal: AbortSignal.timeout(2000),
            })
            if (r.ok) health = await r.json()
          } catch {
            /* startup */
          }
          if (health?.platform === 'win32' && health.pty) break
          await sleep(200)
        }
        assert(health?.platform === 'win32' && health.pty, `backend startup failed: ${log}`)
        assert(binaries, 'probe executable unavailable')
        const base = `http://127.0.0.1:${port}`
        const call = async (method, route, body, token) => {
          const response = await fetch(base + route, {
            method,
            signal: AbortSignal.timeout(5000),
            headers: {
              'content-type': 'application/json',
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          })
          assert(response.ok, `HTTP ${route}: ${response.status}`)
          return response.json()
        }
        const email = 'windows-smoke@example.test'
        await call('POST', '/api/auth/register', { name: 'Smoke user', email, password: '9x!Qp7Z#k2Le' })
        const outbox = await call('GET', '/api/dev/outbox')
        const code = outbox.mails.find((m) => m.to === email)?.subject.slice(0, 6)
        assert(/^\d{6}$/.test(code), 'isolated dev verification code missing')
        const { token } = await call('POST', '/api/auth/verify', { email, code })
        assert(token, 'test account has no session')
        const body = { id: 'windows-smoke', name: 'Windows smoke', cols: 80, rows: 24 }
        const { sid } = await call('POST', '/api/pty/open', body, token)
        assert(sid, 'PTY API did not create a session')
        const controller = new AbortController()
        const streamDeadline = setTimeout(() => controller.abort(), 60000)
        let reader,
          pump,
          terminal = '',
          terminalExit = null,
          pumpError
        try {
          const response = await fetch(`${base}/api/pty/stream?sid=${sid}`, {
            headers: { authorization: `Bearer ${token}` },
            signal: controller.signal,
          })
          assert(response.ok, `PTY stream ${response.status}`)
          reader = response.body.getReader()
          pump = (async () => {
            const decoder = new TextDecoder(),
              ptyDecoder = new TextDecoder()
            let pending = ''
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              pending += decoder.decode(value, { stream: true })
              let nl
              while ((nl = pending.indexOf('\n')) >= 0) {
                const record = JSON.parse(pending.slice(0, nl))
                pending = pending.slice(nl + 1)
                if (record.d)
                  terminal = (
                    terminal + ptyDecoder.decode(Buffer.from(record.d, 'base64'), { stream: true })
                  ).slice(-128 * 1024)
                if (record.x !== undefined) terminalExit = record.x
              }
            }
          })().catch((e) => {
            if (!controller.signal.aborted) pumpError = e
          })
          const waitRecord = async (check, label) => {
            const deadline = Date.now() + 15000
            while (Date.now() < deadline) {
              if (pumpError) throw pumpError
              if (check()) return
              if (terminalExit !== null) break
              await sleep(50)
            }
            throw new Error(
              `HTTP PTY ${label}: exit=${terminalExit}, output=${terminalText(terminal).slice(-500)}`,
            )
          }
          await waitRecord(() => />\s*$/.test(terminalText(terminal)), 'prompt')
          const a = randomBytes(6).toString('hex'),
            b = randomBytes(6).toString('hex')
          const command = `& "${binaries.exe}" ${a} ${b}\r`
          const input = (text) =>
            call('POST', '/api/pty/input', { sid, d: Buffer.from(text).toString('base64') }, token)
          await input(command)
          await waitRecord(() => hasOutputRecord(terminal, `TFEXEC:${a}${b}`), 'executed output (not echo)')
          await waitRecord(() => hasOutputRecord(terminal, 'TFUTF:Привет'), 'UTF-8')
          await waitRecord(() => hasOutputRecord(terminal, 'TFSIZE:80x24'), 'initial dimensions')
          terminal = ''
          await call('POST', '/api/pty/resize', { sid, cols: 117, rows: 39 }, token)
          await sleep(200)
          await input(command)
          await waitRecord(() => hasOutputRecord(terminal, 'TFSIZE:117x39'), 'actual resize')
          await input('exit 29\r')
          await waitRecord(() => terminalExit !== null, 'exit timeout')
          assert(terminalExit === 29, `HTTP PTY expected exit29, got ${terminalExit}`)
        } finally {
          clearTimeout(streamDeadline)
          controller.abort()
          if (reader) await reader.cancel().catch(() => {})
          if (pump) await pump
          await call('POST', '/api/pty/close', { sid }, token).catch(() => {})
        }
        const stopped = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('parent-control graceful shutdown timeout')), 7000)
          child.once('close', (code) => {
            clearTimeout(timer)
            resolve(code)
          })
        })
        child.stdin.on('error', () => {})
        child.stdin.end('{"type":"tetra-shutdown"}\n')
        assert((await stopped) === 0, 'backend graceful shutdown returned nonzero')
      } finally {
        await killTree(child)
      }
    })
    if (process.env.TF_SMOKE_DIAGNOSTICS === '1')
      await step(
        'helper diagnostic version (bounded, offline)',
        async () => {
          assert(binaries, 'helper unavailable')
          console.log(
            `helper=${binaries.helper}; runtime=${process.version}; arch=${process.arch}; OS=${os.release()}`,
          )
        },
        false,
      )
  } finally {
    clearTimeout(watchdog)
    fs.rmSync(dir, { recursive: true, force: true })
  }
  const required = results.filter((r) => r.required),
    failures = required.filter((r) => !r.pass)
  console.log(`smoke-win: required ${required.length - failures.length}/${required.length}`)
  process.exitCode = failures.length ? 1 : 0
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run()
