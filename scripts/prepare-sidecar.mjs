/* Copy the Node runtime that was actually verified, not an equal-sized stale binary. */
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  chmodSync,
  statSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function nodeTriple(platform = process.platform, arch = process.arch) {
  const cpu = { x64: 'x86_64', arm64: 'aarch64', ia32: 'i686' }[arch]
  if (!cpu) throw new Error(`Unsupported Node architecture: ${arch}`)
  const os = { win32: 'pc-windows-msvc', darwin: 'apple-darwin', linux: 'unknown-linux-gnu' }[platform]
  if (!os) throw new Error(`Unsupported Node platform: ${platform}`)
  return `${cpu}-${os}`
}
export function sidecarTriple(
  host,
  target = process.env.CARGO_BUILD_TARGET || process.env.TAURI_ENV_TARGET_TRIPLE,
) {
  const actual = nodeTriple()
  const wanted = target || host || actual
  if (wanted !== actual)
    throw new Error(`Node runtime ${actual} cannot be packaged as ${wanted}; run with matching Node/target`)
  return wanted
}
const digest = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

export function copySidecar(source, dest) {
  const expected = digest(source)
  if (existsSync(dest) && digest(dest) === expected) return false
  mkdirSync(dirname(dest), { recursive: true })
  const temp = `${dest}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    copyFileSync(source, temp)
    chmodSync(temp, statSync(source).mode)
    if (digest(temp) !== expected) throw new Error('sidecar digest mismatch after copy')
    renameSync(temp, dest)
    if (digest(dest) !== expected) throw new Error('sidecar digest mismatch after rename')
    return true
  } finally {
    rmSync(temp, { force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let host
  try {
    host = /^host:\s*(\S+)/m.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8', timeout: 10000 }))?.[1]
  } catch {
    /* actual Node triple below */
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const triple = sidecarTriple(host)
  const dest = join(
    root,
    'src-tauri',
    'binaries',
    `node-${triple}${process.platform === 'win32' ? '.exe' : ''}`,
  )
  const copied = copySidecar(process.execPath, dest)
  console.log(
    `sidecar: ${copied ? 'copied' : 'digest verified'} node ${process.version} sha256=${digest(dest)} → ${dest}`,
  )
}
