/* Проверка того, что нельзя проверить на Linux: запускается в CI на windows-latest (и вручную: node scripts/smoke-win.mjs).
   1) помощник ConPTY компилируется штатным csc.exe и отдаёт вывод cmd.exe, принимает смену размера;
   2) хранилище ключей на DPAPI: круг «записал → прочитал», в файле нет открытого текста;
   3) сервер стартует по пути с префиксом \\?\ без TF_SERVE (регресс 2.5.1) и отвечает на /api/health. */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') {
  console.log('smoke-win: пропущено (не Windows)')
  process.exit(0)
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = []
const step = async (name, fn) => {
  const t = Date.now()
  try {
    await fn()
    results.push([name, true])
    console.log(`ok   ${name} (${Date.now() - t} мс)`)
  } catch (e) {
    results.push([name, false])
    console.log(`FAIL ${name}: ${e?.stack || e}`)
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const assert = (c, m) => {
  if (!c) throw new Error(m)
}

await step('ConPTY: сборка помощника, вывод и ресайз', async () => {
  const { ensureConPty } = await import(new URL('../server/conpty-win.mjs', import.meta.url))
  const exe = await ensureConPty()
  assert(fs.existsSync(exe), 'exe не создан: ' + exe)
  const p = spawn(exe, ['80', '24', 'cmd.exe /q'], { windowsHide: true })
  let out = ''
  p.stdout.on('data', (d) => (out += d.toString('utf8')))
  let err = ''
  p.stderr.on('data', (d) => (err += d.toString()))
  const waitFor = async (re, ms = 15000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (re.test(out)) return
      await sleep(100)
    }
    throw new Error(`нет ${re} в выводе: ${JSON.stringify(out.slice(-300))} stderr=${err}`)
  }
  p.stdin.write('echo hello-conpty\r\n')
  await waitFor(/hello-conpty/)
  p.stdin.write('\0TFRSZ 100 30\n')
  await sleep(300)
  p.stdin.write('echo second-line\r\n')
  await waitFor(/second-line/)
  p.stdin.write('exit\r\n')
  await new Promise((r) => {
    const t = setTimeout(() => (p.kill(), r()), 5000)
    p.on('exit', () => (clearTimeout(t), r()))
  })
})

await step('DPAPI: хранилище ключей', async () => {
  const { createVault } = await import(new URL('../server/secrets.mjs', import.meta.url))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-vault-'))
  const secret = 'sk-test-' + 'Z9x'.repeat(8)
  const v = createVault({ dir, win: true })
  assert(v.mode === 'dpapi', 'режим ' + v.mode)
  await v.set('openai', secret)
  const raw = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8')
  assert(!raw.includes(secret), 'ключ лежит в файле открытым текстом')
  const again = createVault({ dir, win: true })
  assert((await again.list()).openai === secret, 'после перечитывания ключ не совпал')
  await again.remove('openai')
  assert(!('openai' in (await createVault({ dir, win: true }).list())), 'ключ не удалился')
})

await step('Сервер: старт по пути \\\\?\\ без TF_SERVE', async () => {
  const port = 3900 + Math.floor(Math.random() * 90)
  const script = '\\\\?\\' + path.join(root, 'server', 'tetra-server.mjs')
  const env = {
    ...process.env,
    PORT: String(port),
    HOME: os.tmpdir(),
    USERPROFILE: fs.mkdtempSync(path.join(os.tmpdir(), 'tf-home-')),
  }
  delete env.TF_SERVE
  const p = spawn(process.execPath, [script], { env, windowsHide: true })
  let log = ''
  p.stdout.on('data', (d) => (log += d))
  p.stderr.on('data', (d) => (log += d))
  try {
    let ok = null
    for (let i = 0; i < 40 && !ok; i++) {
      await sleep(250)
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`)
        if (r.ok) ok = await r.json()
      } catch {}
    }
    assert(ok, 'сервер не ответил. Вывод: ' + log.slice(-500))
    assert(ok.platform === 'win32', 'platform=' + ok.platform)
    for (let i = 0; i < 40 && !ok.pty; i++) {
      await sleep(500) /* помощник готовится в фоне */
      ok = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()
    }
    console.log(`     health: pty=${ok.pty}`)
    assert(ok.pty === true, 'в /api/health pty=false (помощник ConPTY недоступен)')
  } finally {
    p.kill()
  }
})

const bad = results.filter((r) => !r[1])
console.log(`\nsmoke-win: ${results.length - bad.length}/${results.length}`)
process.exit(bad.length ? 1 : 0)
