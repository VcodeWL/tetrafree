/* Хранилище секретов (ключи API провайдеров) вне localStorage браузера.
   Windows: шифрование DPAPI от имени текущего пользователя (то же, что под капотом у Диспетчера учётных данных):
   файл secrets.json содержит только шифртекст, расшифровать его может лишь этот пользователь на этом компьютере.
   Linux/macOS (разработка): AES-256-GCM, ключ лежит рядом в secrets.key с правами 600 — это защита от случайного
   просмотра, а не от того, кто уже читает ваши файлы. */
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const PS_ENC = `
$ErrorActionPreference = 'Stop'
$in = $env:TF_IN | ConvertFrom-Json
$o = [ordered]@{}
foreach ($p in $in.PSObject.Properties) {
  $o[$p.Name] = ConvertTo-SecureString -String ([string]$p.Value) -AsPlainText -Force | ConvertFrom-SecureString
}
ConvertTo-Json -InputObject $o -Compress
`
const PS_DEC = `
$ErrorActionPreference = 'Stop'
$in = $env:TF_IN | ConvertFrom-Json
$o = [ordered]@{}
foreach ($p in $in.PSObject.Properties) {
  try {
    $s = ConvertTo-SecureString -String ([string]$p.Value)
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { $o[$p.Name] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
  } catch { }
}
[Console]::OutputEncoding = [Text.Encoding]::UTF8
ConvertTo-Json -InputObject $o -Compress
`

/** запуск PowerShell со скриптом в -EncodedCommand; данные идут через переменную окружения, не через командную строку */
export function runPowerShell(script, data) {
  return new Promise((resolve, reject) => {
    const enc = Buffer.from(script, 'utf16le').toString('base64')
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
      {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 4 << 20,
        env: { ...process.env, TF_IN: JSON.stringify(data) },
      },
      (err, out) => {
        if (err) return reject(err)
        try {
          resolve(JSON.parse(String(out).trim() || '{}'))
        } catch (e) {
          reject(e)
        }
      },
    )
  })
}

export const validId = (id) => typeof id === 'string' && /^[\w-]{1,64}$/.test(id)
export const validValue = (v) => typeof v === 'string' && v.length > 0 && v.length <= 4096

function fileBackend(keyFile) {
  const key = () => {
    try {
      const k = fs.readFileSync(keyFile)
      if (k.length === 32) return k
    } catch {
      /* создадим */
    }
    const k = crypto.randomBytes(32)
    fs.mkdirSync(path.dirname(keyFile), { recursive: true })
    fs.writeFileSync(keyFile, k, { mode: 0o600 })
    return k
  }
  return {
    mode: 'file',
    async encrypt(items) {
      const k = key()
      const out = {}
      for (const [id, v] of Object.entries(items)) {
        const iv = crypto.randomBytes(12)
        const c = crypto.createCipheriv('aes-256-gcm', k, iv)
        const ct = Buffer.concat([c.update(v, 'utf8'), c.final()])
        out[id] = Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')
      }
      return out
    },
    async decrypt(items) {
      const k = key()
      const out = {}
      for (const [id, b] of Object.entries(items)) {
        try {
          const raw = Buffer.from(b, 'base64')
          const d = crypto.createDecipheriv('aes-256-gcm', k, raw.subarray(0, 12))
          d.setAuthTag(raw.subarray(12, 28))
          out[id] = Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
        } catch {
          /* повреждено или чужой ключ — пропускаем */
        }
      }
      return out
    },
  }
}

function dpapiBackend(run) {
  return {
    mode: 'dpapi',
    encrypt: (items) => (Object.keys(items).length ? run(PS_ENC, items) : Promise.resolve({})),
    decrypt: (items) => (Object.keys(items).length ? run(PS_DEC, items) : Promise.resolve({})),
  }
}

/** dir — папка данных (~/TetraFree); win/run подменяются в тестах */
export function createVault({ dir, win = process.platform === 'win32', run = runPowerShell } = {}) {
  const file = path.join(dir, 'secrets.json')
  const be = win ? dpapiBackend(run) : fileBackend(path.join(dir, 'secrets.key'))
  let plain = null // расшифрованное в памяти процесса
  let chain = Promise.resolve()
  const queue = (fn) => {
    const p = chain.then(fn, fn)
    chain = p.catch(() => {})
    return p
  }
  const readBlobs = () => {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'))
      return j && j.items && typeof j.items === 'object' ? j.items : {}
    } catch {
      return {}
    }
  }
  const load = async () => {
    if (!plain) plain = await be.decrypt(readBlobs())
    return plain
  }
  const save = async () => {
    const items = await be.encrypt(plain)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, mode: be.mode, items }, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, file)
  }
  return {
    mode: be.mode,
    list: () => queue(async () => ({ ...(await load()) })),
    set: (id, value) =>
      queue(async () => {
        if (!validId(id) || !validValue(value)) throw new Error('Некорректный секрет')
        const m = await load()
        const prev = m[id]
        m[id] = value
        try {
          await save()
        } catch (e) {
          if (prev === undefined) delete m[id]
          else m[id] = prev
          throw e
        }
      }),
    remove: (id) =>
      queue(async () => {
        if (!validId(id)) throw new Error('Некорректный секрет')
        const m = await load()
        if (!(id in m)) return
        const prev = m[id]
        delete m[id]
        try {
          await save()
        } catch (e) {
          m[id] = prev
          throw e
        }
      }),
  }
}

/** маршруты /api/secrets*: вызываются уже после проверки «локально и вошёл» */
export async function secretRoutes(req, res, u, io, vault) {
  if (!u.pathname.startsWith('/api/secrets')) return false
  const out = (c, b) => io.json(res, c, b)
  try {
    if (u.pathname === '/api/secrets' && req.method === 'GET') {
      out(200, { mode: vault.mode, items: await vault.list() })
    } else if (u.pathname === '/api/secrets/set' && req.method === 'POST') {
      const b = await io.readBody(req)
      await vault.set(b.id, b.value)
      out(200, { ok: true })
    } else if (u.pathname === '/api/secrets/delete' && req.method === 'POST') {
      const b = await io.readBody(req)
      await vault.remove(b.id)
      out(200, { ok: true })
    } else out(404, { error: { message: 'Нет такого метода' } })
  } catch (e) {
    out(500, { error: { message: 'Хранилище ключей: ' + (e?.message || e) } })
  }
  return true
}
