/* Картинки (логотип, фон, иконки приложения) лежат в репозитории как base64-текст в binary-assets/ —
   так их можно хранить и менять вместе с кодом любым инструментом. Скрипт раскладывает их по местам,
   если файла ещё нет. Запускается сам после `npm ci` / `npm install` (postinstall).
   Заменить картинку: положи настоящий файл на место и обнови .b64 командой `node scripts/restore-binaries.mjs --pack`. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'binary-assets')
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
const pack = process.argv.includes('--pack')

for (const [dest, name] of Object.entries(manifest)) {
  const file = join(root, dest)
  const b64 = join(dir, name + '.b64')
  if (pack) {
    writeFileSync(
      b64,
      readFileSync(file)
        .toString('base64')
        .replace(/(.{76})/g, '$1\n') + '\n',
    )
    console.log('упаковано:', dest)
  } else if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, Buffer.from(readFileSync(b64, 'utf8').replace(/\s+/g, ''), 'base64'))
    console.log('восстановлено:', dest)
  }
}
