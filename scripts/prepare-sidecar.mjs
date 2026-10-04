/* Кладёт Node.js рядом с приложением как sidecar (src-tauri/binaries/node-<triple>[.exe]),
   чтобы встроенный сервер TetraFree работал на машине, где Node не установлен.
   Берётся тот node, которым запущен скрипт (в CI это Node из actions/setup-node). */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function hostTriple() {
  try {
    const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
    const m = /^host:\s*(\S+)/m.exec(out)
    if (m) return m[1]
  } catch {
    /* rustc нет в PATH — определим по платформе */
  }
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`
  if (process.platform === 'darwin') return `${arch}-apple-darwin`
  return `${arch}-unknown-linux-gnu`
}

const triple = hostTriple()
const ext = process.platform === 'win32' ? '.exe' : ''
const dir = join(root, 'src-tauri', 'binaries')
const dest = join(dir, `node-${triple}${ext}`)
mkdirSync(dir, { recursive: true })
if (existsSync(dest) && statSync(dest).size === statSync(process.execPath).size) {
  console.log(`sidecar: уже на месте — ${dest}`)
} else {
  copyFileSync(process.execPath, dest)
  console.log(`sidecar: node ${process.version} → ${dest}`)
}
