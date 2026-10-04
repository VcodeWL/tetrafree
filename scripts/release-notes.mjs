/* Заметки релиза из CHANGELOG.md для GitHub Releases и latest.json.
   node scripts/release-notes.mjs v2.6.0 — печатает раздел «## 2.6.0»; в CI пишет его же в $GITHUB_OUTPUT (поле body).
   Также сверяет версию тега с package.json, tauri.conf.json и Cargo.toml — несовпадение останавливает сборку. */
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const tag = process.argv[2] || process.env.GITHUB_REF_NAME || ''
  const version = tag.replace(/^v/, '')
  const v = versions()
  const bad = Object.entries(v).filter(([, x]) => x !== version)
  if (!version || bad.length) {
    console.error(`Тег ${tag} не совпадает с версиями в файлах:`)
    for (const [f, x] of Object.entries(v)) console.error(`  ${f}: ${x}`)
    console.error('Подними версию во всех трёх файлах, закоммить и создай тег заново.')
    process.exit(1)
  }
  const body = section(read('CHANGELOG.md'), version)
  if (!body) {
    console.error(`В CHANGELOG.md нет раздела «## ${version}»`)
    process.exit(1)
  }
  const out = process.env.GITHUB_OUTPUT
  if (out) fs.appendFileSync(out, `body<<TF_EOF\n${body}\nTF_EOF\n`)
  else console.log(body)
}
