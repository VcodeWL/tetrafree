import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMatch, defaultPage } from './match'
import { parseAuto, autoPrompt, FOCUS, autoHooks } from './autopilot'
import { parseStream, summarizeForHistory } from './protocol'
import { wireMsg } from './llm'
import { shotTarget } from './webtools'

test('parseMatch: порог, лимит, файл, адрес, заметки', () => {
  assert.deepEqual(parseMatch(''), { threshold: 0.96, max: 0, notes: '' })
  const s = parseMatch('97% x20 site/index.html шапка как на эталоне')
  assert.equal(s.threshold, 0.97)
  assert.equal(s.max, 20)
  assert.equal(s.path, 'site/index.html')
  assert.equal(s.notes, 'шапка как на эталоне')
  assert.equal(parseMatch('http://localhost:5173/ 99,5%').url, 'http://localhost:5173/')
  assert.equal(parseMatch('порог 90%').threshold, 0.9)
  assert.ok(parseMatch('30%').error)
  assert.equal(parseMatch('x999').max, 60)
})

test('defaultPage: корневые html в приоритете', () => {
  assert.equal(defaultPage({ 'a.html': '', 'index.html': '' }), 'index.html')
  assert.equal(defaultPage({ 'site/index.html': '', 'x.html': '' }), 'site/index.html')
  assert.equal(defaultPage({ 'docs/p.html': '' }), 'docs/p.html')
  assert.equal(defaultPage({ 'a.ts': '' }), '')
})

test('parseAuto: направления, пауза, число проходов, заметки', () => {
  const all = parseAuto('')
  assert.equal(all.focus.length, FOCUS.length)
  assert.equal(all.max, 0)
  const s = parseAuto('баги, тесты каждые 10m x30 только сервер')
  assert.deepEqual(
    s.focus.map((f) => f.id),
    ['bugs', 'tests'],
  )
  assert.equal(s.gap, 600000)
  assert.equal(s.max, 30)
  assert.equal(s.notes, 'только сервер')
  assert.equal(parseAuto('сделай красиво').focus.length, FOCUS.length)
  assert.equal(parseAuto('сделай красиво').notes, 'сделай красиво')
})

test('автопилот: направления чередуются, журнал и правила в запросе', async () => {
  const h = autoHooks(parseAuto(''), () => '## Сделано\n- прошлое')
  const p1 = await h.before!(1, {} as never)
  const p2 = await h.before!(2, {} as never)
  assert.match(p1.extra!, /Фокус этого прохода: «Поиск и исправление багов»/)
  assert.match(p2.extra!, /«Тесты»/)
  assert.match(p1.extra!, /- прошлое/)
  assert.match(p1.extra!, /\.tetra\/autopilot\.md/)
  assert.ok(h.ignoreDone)
  assert.match(
    autoPrompt(1, FOCUS[0], 'заметка', '', true),
    /пока пуст[\s\S]*Пожелания пользователя: заметка/,
  )
  assert.equal(new Set(FOCUS.map((f) => f.id)).size, FOCUS.length)
})

test('протокол: fetch/search/shot разбираются и сворачиваются для истории', () => {
  const segs = parseStream(
    'Смотрю <fetch url="https://a.dev/x" /> и <search>vite plugin</search> <shot path="index.html" width="800" />',
    false,
  )
  const ops = segs.filter((s) => s.t === 'op') as {
    kind: string
    attrs: Record<string, string>
    body: string
  }[]
  assert.deepEqual(
    ops.map((o) => o.kind),
    ['fetch', 'search', 'shot'],
  )
  assert.equal(ops[0].attrs.url, 'https://a.dev/x')
  assert.equal(ops[1].body, 'vite plugin')
  assert.equal(ops[2].attrs.width, '800')
  assert.match(summarizeForHistory('<search>q</search>'), /<search>q<\/search>/)
  /* недописанный тег не мигает в потоке */
  assert.equal(
    parseStream('Смотрю <fet', true)
      .map((s) => (s.t === 'text' ? s.s : ''))
      .join(''),
    'Смотрю ',
  )
})

test('картинки в сообщении: формат OpenAI и Anthropic', () => {
  const m = { role: 'user' as const, content: 'глянь', images: ['data:image/png;base64,AAAA', 'не картинка'] }
  const o = wireMsg(m, false) as { content: { type: string }[] }
  assert.deepEqual(
    o.content.map((c) => c.type),
    ['image_url', 'text'],
  )
  const a = wireMsg(m, true) as { content: { type: string; source?: { media_type: string; data: string } }[] }
  assert.equal(a.content[0].source!.media_type, 'image/png')
  assert.equal(a.content[0].source!.data, 'AAAA')
  assert.deepEqual(wireMsg({ role: 'user', content: 'x' }, false), { role: 'user', content: 'x' })
})

test('shotTarget: страница проекта или локальный адрес', () => {
  ;(globalThis as { location?: unknown }).location = { origin: 'http://127.0.0.1:3000' }
  assert.equal(shotTarget({ name: 'p' }, { url: 'http://localhost:5173/' }).url, 'http://localhost:5173/')
  assert.match(
    shotTarget({ name: 'мой проект' }, { path: 'site/index.html' }).url,
    /\/preview\/.*\/%D0%BC.*\/site\/index\.html$/,
  )
})
