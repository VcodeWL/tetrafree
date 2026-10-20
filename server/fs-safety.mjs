import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const invalid = () =>
  Object.assign(new Error('Путь ведёт за пределы папки проекта или недоступен'), { status: 400 })
export function inside(dir, rel) {
  if (typeof rel !== 'string' || rel.includes('\0')) throw invalid()
  const abs = path.resolve(dir, rel)
  if (!contained(path.resolve(dir), abs)) throw invalid()
  const local = path.relative(path.resolve(dir), abs)
  if (
    process.platform === 'win32' &&
    (/^[a-z]:[^\\/]/i.test(rel) ||
      local
        .split(/[\\/]/)
        .some((s) => /[:]|[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)))
  )
    throw invalid()
  return abs
}

const contained = (root, abs) => {
  const r = path.relative(root, abs)
  return !r || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r))
}
// Resolve a missing leaf through its nearest real ancestor. Only ENOENT is recoverable;
// dangling links and permission/IO errors fail closed. Not an OS-level race-free sandbox.
async function projectedReal(abs) {
  try {
    return await fsp.realpath(abs)
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
    const st = await fsp.lstat(abs).catch((x) => {
      if (x.code !== 'ENOENT') throw x
      return null
    })
    if (st) throw invalid()
    const up = path.dirname(abs)
    if (up === abs) throw invalid()
    return path.join(await projectedReal(up), path.basename(abs))
  }
}
export async function realInside(dir, abs) {
  if (!contained(path.resolve(dir), path.resolve(abs))) throw invalid()
  if (!contained(await projectedReal(dir), await projectedReal(abs))) throw invalid()
  return abs
}
export function realInsideSync(dir, abs) {
  const root = fs.realpathSync(dir),
    target = fs.realpathSync(abs)
  if (!contained(root, target)) throw invalid()
  return abs
}
export async function finalFile(dir, rel, { preview = false } = {}) {
  let abs = inside(dir, rel)
  await realInside(dir, abs)
  if ((await fsp.stat(abs)).isDirectory()) abs = path.join(abs, 'index.html')
  await realInside(dir, abs)
  const relative = path.relative(dir, abs).split(path.sep)
  if (preview && relative.some((s) => s.startsWith('.') || s === 'node_modules')) throw invalid()
  if (!(await fsp.stat(abs)).isFile()) throw invalid()
  return abs
}
export function fnv(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + ':' + s.length
}
export async function matchesExpected(dir, rel, expected) {
  const abs = inside(dir, rel)
  await realInside(dir, abs)
  try {
    const text = await fsp.readFile(abs, 'utf8')
    return expected !== null && fnv(text) === expected
  } catch (e) {
    if (e.code === 'ENOENT') return expected === null
    throw e
  }
}
// Serialize our own writers only. Other programs may still change a file between
// comparison and write/delete; Node does not provide native atomic compare+write.
const locks = new Map()
export async function withProjectLock(dir, work) {
  const key = await projectedReal(path.resolve(dir))
  const previous = locks.get(key) || Promise.resolve()
  let release
  const gate = new Promise((r) => {
    release = r
  })
  const tail = previous.then(() => gate)
  locks.set(key, tail)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (locks.get(key) === tail) locks.delete(key)
  }
}
