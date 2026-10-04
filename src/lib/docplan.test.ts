import test from 'node:test'
import assert from 'node:assert/strict'
import { planDocs, slugName, type DocBase, type DocLite } from './docplan'
import { docMd } from './docmd'
import type { Block } from '../types'

const h = (s: string) => s.length + ':' + s.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
const p = (text: string): Block => ({ id: 'b' + text, type: 'p', text })
const doc = (id: string, title: string, text = 'текст', file?: string): DocLite => ({
  id,
  title,
  blocks: [p(text)],
  file,
})

test('имя файла: запрещённые символы, зарезервированные имена, пустое', () => {
  assert.equal(slugName('План: v1/v2?'), 'План- v1-v2-')
  assert.equal(slugName('con'), '_con')
  assert.equal(slugName('   '), 'Без названия')
  assert.equal(slugName('конец...'), 'конец')
})

test('новый документ → файл docs/<название>.md, одинаковые названия не затираются', () => {
  const r = planDocs([doc('1', 'Заметки'), doc('2', 'Заметки')], {}, {}, h, false)
  assert.deepEqual(Object.keys(r.write).sort(), ['docs/Заметки (2).md', 'docs/Заметки.md'])
  assert.equal(r.attach['1'], 'docs/Заметки.md')
  assert.equal(r.write['docs/Заметки.md'], docMd(doc('1', 'Заметки')))
})

test('второй проход без правок ничего не меняет', () => {
  const d = [doc('1', 'A')]
  const r1 = planDocs(d, {}, {}, h, false)
  const r2 = planDocs([{ ...d[0], file: r1.attach['1'] }], r1.write, r1.base, h, false)
  assert.deepEqual(r2.write, {})
  assert.equal(r2.update.length + r2.add.length + r2.remove.length, 0)
})

function settled(title = 'A', text = 'текст') {
  const d = doc('1', title, text)
  const r = planDocs([d], {}, {}, h, false)
  return { d: { ...d, file: r.attach['1'] }, files: r.write, base: r.base }
}

test('правка документа → файл обновляется', () => {
  const s = settled()
  const r = planDocs([{ ...s.d, blocks: [p('новое')] }], s.files, s.base, h, false)
  assert.equal(r.write[s.d.file!], docMd({ title: 'A', blocks: [p('новое')] }))
})

test('правка файла снаружи → документ обновляется', () => {
  const s = settled()
  const files = { [s.d.file!]: '# Другое\n\nснаружи\n' }
  const r = planDocs([s.d], files, s.base, h, false)
  assert.equal(r.update.length, 1)
  assert.equal(r.update[0].title, 'Другое')
  assert.equal(r.update[0].blocks[0].text, 'снаружи')
  assert.deepEqual(r.write, {})
})

test('правили и документ, и файл → документ главный, версия файла — в копию, копия станет документом', () => {
  const s = settled()
  const files = { [s.d.file!]: '# A\n\nс диска\n' }
  const r = planDocs([{ ...s.d, blocks: [p('из приложения')] }], files, s.base, h, false)
  assert.equal(r.write['docs/A.md'], docMd({ title: 'A', blocks: [p('из приложения')] }))
  assert.equal(r.write['docs/A (копия с диска).md'], '# A\n\nс диска\n')
  assert.equal(r.add.length, 1)
  assert.equal(r.add[0].file, 'docs/A (копия с диска).md')
})

test('файл пропал — документ не теряется, файл возвращается', () => {
  const s = settled()
  const r = planDocs([s.d], {}, s.base, h, false)
  assert.equal(r.write[s.d.file!], docMd(s.d))
  assert.equal(r.update.length, 0)
})

test('документ удалён в приложении → нетронутый файл удаляется, изменённый остаётся и становится документом', () => {
  const s = settled()
  const r = planDocs([], s.files, s.base, h, false)
  assert.deepEqual(r.remove, [s.d.file])
  const r2 = planDocs([], { [s.d.file!]: '# A\n\nправка\n' }, s.base, h, false)
  assert.deepEqual(r2.remove, [])
  assert.equal(r2.add.length, 1)
})

test('чужие .md из docs/ становятся документами; вложенные папки и не-md — нет; сотни при первом запуске — нет', () => {
  const files = {
    'docs/guide.md': '# Гид\n\nтекст',
    'docs/sub/x.md': 'x',
    'docs/a.txt': 'x',
    'README.md': 'x',
  }
  const r = planDocs([], files, {}, h, true)
  assert.deepEqual(
    r.add.map((a) => a.file),
    ['docs/guide.md'],
  )
  const many: Record<string, string> = {}
  for (let i = 0; i < 25; i++) many[`docs/n${i}.md`] = '# n'
  assert.equal(planDocs([], many, {}, h, true).add.length, 0)
  assert.equal(planDocs([], many, {}, h, false).add.length, 25)
})

test('документы с картинками не зеркалятся', () => {
  const d: DocLite = {
    id: '1',
    title: 'Pic',
    blocks: [{ id: 'i', type: 'image', text: '', src: 'data:image/png;base64,AAAA' }],
  }
  assert.deepEqual(planDocs([d], {}, {} as DocBase, h, false).write, {})
})
