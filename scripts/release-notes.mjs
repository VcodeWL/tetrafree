/* Заметки релиза из CHANGELOG.md для GitHub Releases и latest.json.
   node scripts/release-notes.mjs v2.6.0 — печатает раздел «## 2.6.0»; в CI пишет его же в $GITHUB_OUTPUT (поле body).
   Версия релиза берётся из тега: скрипт сам прописывает её в package.json, tauri.conf.json и Cargo.toml сборочной копии. */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const read = (p) => fs.readFileSync(fileURLToPath(new URL(p, root)), 'utf8')

export function section(md, version) {
  const lines = md.split(/\r?\n/)
  const head = new RegExp('^##\\s+\\[?v?' + version.replace(/\./g, '\\.') + '(?![\\w.])')
  const i = lines.findIndex((l) => head.test(l))
  if (i < 0) return null
  let j = i + 1
  while (j < lines.length && !/^##\s/.test(lines[j])) j++
  return lines
    .slice(i + 1, j)
    .join('\n')
    .trim()
}

export function versions() {
  return {
    'package.json': JSON.parse(read('package.json')).version,
    'src-tauri/tauri.conf.json': JSON.parse(read('src-tauri/tauri.conf.json')).version,
    'src-tauri/Cargo.toml': /^version\s*=\s*"([^"]+)"/m.exec(read('src-tauri/Cargo.toml'))?.[1],
  }
}

/** «v3.0.2», «V3.0.2», «v.3.0.2», «3.0.2» → «3.0.2»; всё остальное → null */
export function versionFromTag(tag) {
  const m = /^[vV]?\.?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(String(tag).trim())
  return m ? m[1] : null
}

/** Подставляет версию в тексты трёх файлов (чистая функция). */
export function applyVersion(files, version) {
  return {
    'package.json': files['package.json'].replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`),
    'src-tauri/tauri.conf.json': files['src-tauri/tauri.conf.json'].replace(
      /("version"\s*:\s*")[^"]+(")/,
      `$1${version}$2`,
    ),
    'src-tauri/Cargo.toml': files['src-tauri/Cargo.toml'].replace(
      /^(version\s*=\s*")[^"]+(")/m,
      `$1${version}$2`,
    ),
  }
}

/* Запуск в CI: версия берётся из ТЕГА — файлы вручную поднимать не нужно. Изменения остаются только в сборочной копии. */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const tag = process.argv[2] || process.env.GITHUB_REF_NAME || ''
  const version = versionFromTag(tag)
  if (!version) {
    console.error(`Тег «${tag}» не похож на версию. Нужен вид v3.1.0 (три числа через точку).`)
    process.exit(1)
  }
  const names = ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml']
  const next = applyVersion(Object.fromEntries(names.map((n) => [n, read(n)])), version)
  for (const n of names) fs.writeFileSync(fileURLToPath(new URL(n, root)), next[n])
  console.error(`Версия сборки: ${version} (из тега ${tag})`)
  const body =
    section(read('CHANGELOG.md'), version) ||
    `Список изменений: https://github.com/${process.env.GITHUB_REPOSITORY || 'VcodeWL/tetrafree'}/blob/main/CHANGELOG.md`
  const out = process.env.GITHUB_OUTPUT
  if (out) fs.appendFileSync(out, `body<<TF_EOF\n${body}\nTF_EOF\n`)
  else console.log(body)
}
