import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseAutomations,
  parseEvery,
  globToRe,
  matchFiles,
  dueNow,
  expand,
  underLimit,
  addAutomation,
  updateAutomation,
  autoHash,
  describeWhen,
  describeDo,
  EXAMPLES,
  MAX_PER_HOUR,
} from './automations'

test('parseEvery: единицы, границы, мусор', () => {
  assert.equal(parseEvery('30m')?.ms, 30 * 60_000)
  assert.equal(parseEvery('2h')?.ms, 2 * 3600_000)
  assert.equal(parseEvery('1д')?.ms, 86_400_000)
  assert.equal(parseEvery('5 мин')?.label, '5 мин')
  for (const bad of ['0m', '10s', 'часто', '', null, '99999m'])
    assert.equal(parseEvery(bad), null, String(bad))
})

test('parseAutomations: все виды условий и действий, значения по умолчанию', () => {
  const t = JSON.stringify({
    automations: [
      { name: 'A', when: { every: '30m' }, do: { agent: 'сделай' } },
      { name: 'B', when: { daily: '09:30' }, do: { notify: 'привет' } },
      { name: 'C', when: { files: 'src/**/*.ts' }, do: { task: 'проверить {{files}}' } },
      { name: 'D', when: { task: 'done' }, do: { agent: 'x', tier: 'Уведомить' }, enabled: false },
      { name: 'E', when: { open: true }, do: { notify: 'открыт' } },
      { name: 'F', when: { manual: true }, do: { notify: 'вручную' } },
    ],
  })
  const { list, errors } = parseAutomations(t)
  assert.deepEqual(errors, [])
  assert.equal(list.length, 6)
  assert.deepEqual(list[0].do, { agent: 'сделай', tier: 'Спросить' }, 'по умолчанию — «Спросить»')
  assert.deepEqual(list[2].when, { files: ['src/**/*.ts'] })
  assert.equal(list[3].enabled, false)
  assert.equal(list[0].enabled, true)
  assert.ok(list.every((a) => describeWhen(a.when) && describeDo(a.do)))
})

test('parseAutomations: плохие записи пропускаются с понятной ошибкой, остальные живут', () => {
  const t = JSON.stringify({
    automations: [
      { name: 'ok', when: { manual: true }, do: { notify: 'x' } },
      { when: { manual: true }, do: { notify: 'x' } },
      { name: 'без do', when: { manual: true } },
      { name: 'часто', when: { every: '10s' }, do: { notify: 'x' } },
      { name: 'время', when: { daily: '25:99' }, do: { notify: 'x' } },
      { name: 'статус', when: { task: 'wat' }, do: { notify: 'x' } },
      { name: 'пустое', when: { manual: true }, do: { agent: '  ' } },
      { name: 'уровень', when: { manual: true }, do: { agent: 'x', tier: 'Рискнуть' } },
      { name: 'ничего', when: {}, do: { notify: 'x' } },
      5,
    ],
  })
  const { list, errors } = parseAutomations(t)
  assert.deepEqual(
    list.map((a) => a.name),
    ['ok'],
  )
  assert.equal(errors.length, 9)
  assert.ok(errors.some((e) => e.includes('every')))
  assert.deepEqual(parseAutomations('не json').list, [])
  assert.ok(parseAutomations('{}').errors.length)
  assert.deepEqual(parseAutomations('').errors, [])
})

test('одинаковые имена получают разные id', () => {
  const t = JSON.stringify({
    automations: [1, 2, 3].map(() => ({ name: 'Одно', when: { manual: true }, do: { notify: 'x' } })),
  })
  assert.deepEqual(
    parseAutomations(t).list.map((a) => a.id),
    ['одно', 'одно-2', 'одно-3'],
  )
})

test('маски файлов', () => {
  assert.ok(globToRe('src/**/*.ts').test('src/a/b/c.ts'))
  assert.ok(globToRe('src/**/*.ts').test('src/c.ts'))
  assert.ok(!globToRe('src/*.ts').test('src/a/c.ts'))
  assert.ok(globToRe('*.md').test('README.md'))
  assert.ok(!globToRe('*.md').test('docs/README.md'))
  assert.ok(globToRe('a?.js').test('ab.js'))
  assert.ok(!globToRe('a.js').test('abjs'), 'точка — не любой символ')
  assert.deepEqual(matchFiles(['src/**'], ['src/a.ts', '.tetra/x.json', 'docs/a.md']), ['src/a.ts'])
  assert.deepEqual(
    matchFiles(['**'], ['.tetra/automations.json']),
    [],
    'служебные файлы не запускают автоматизации',
  )
})

test('расписание: every и daily без догонялок', () => {
  const t = (h: number, m: number) => new Date(2025, 0, 10, h, m).getTime()
  assert.equal(dueNow({ every: 600_000, label: '' }, 1_000_000, 300_000), true)
  assert.equal(dueNow({ every: 600_000, label: '' }, 800_000, 300_000), false)
  assert.equal(dueNow({ daily: '09:00' }, t(9, 5), 0), true)
  assert.equal(dueNow({ daily: '09:00' }, t(8, 59), 0), false)
  assert.equal(dueNow({ daily: '09:00' }, t(9, 5), t(9, 1)), false, 'уже сработала сегодня')
  assert.equal(dueNow({ daily: '09:00' }, t(11, 0), 0), false, 'пропущенное утро не догоняем')
  assert.equal(dueNow({ daily: '09:00' }, t(9, 5), t(9, 0) - 86_400_000), true)
  assert.equal(dueNow({ manual: true }, t(9, 5), 0), false)
})

test('шаблоны: подстановка и неизвестные переменные остаются как есть', () => {
  const ctx = {
    files: ['a.ts', 'b.ts'],
    task: 'Починить',
    name: 'N',
    project: 'P',
    now: new Date(2025, 0, 2, 3, 4).getTime(),
  }
  assert.equal(
    expand('{{files}} | {{task}} | {{name}} | {{project}} | {{now}} | {{что}}', ctx),
    'a.ts, b.ts | Починить | N | P | 2025-01-02 03:04 | {{что}}',
  )
  assert.match(
    expand('{{files}}', { ...ctx, files: Array.from({ length: 25 }, (_, i) => 'f' + i) }),
    /и ещё 5$/,
  )
})

test('лимит срабатываний в час', () => {
  const now = 10_000_000
  assert.equal(underLimit([], now), true)
  assert.equal(underLimit(Array(MAX_PER_HOUR).fill(now - 1000), now), false)
  assert.equal(underLimit(Array(MAX_PER_HOUR).fill(now - 3700_000), now), true, 'старые не считаются')
})

test('правка файла: добавление, выключение, удаление; чужие поля сохраняются', () => {
  let t = addAutomation(undefined, { name: 'A', when: { manual: true }, do: { notify: 'x' } })
  t = addAutomation(t, { name: 'B', when: { manual: true }, do: { notify: 'y' } })
  assert.equal(parseAutomations(t).list.length, 2)
  const off = updateAutomation(t, 'a', (r) => ({ ...r, enabled: false }))
  assert.equal(parseAutomations(off).list[0].enabled, false)
  assert.equal(parseAutomations(off).list[1].enabled, true)
  const del = updateAutomation(off, 'b', () => null)
  assert.deepEqual(
    parseAutomations(del).list.map((a) => a.id),
    ['a'],
  )
  assert.throws(() => addAutomation('{oops', {}))
  assert.equal(
    updateAutomation(t, 'нет-такой', () => null),
    t,
  )
})

test('хэш разрешения зависит от проекта и содержимого', async () => {
  const [a] = parseAutomations(
    JSON.stringify({ automations: [{ name: 'A', when: { manual: true }, do: { agent: 'x' } }] }),
  ).list
  const [b] = parseAutomations(
    JSON.stringify({ automations: [{ name: 'A', when: { manual: true }, do: { agent: 'y' } }] }),
  ).list
  const h = await autoHash('p1', a)
  assert.match(h, /^[0-9a-f]{64}$/)
  assert.notEqual(h, await autoHash('p2', a))
  assert.notEqual(h, await autoHash('p1', b))
  assert.equal(h, await autoHash('p1', a))
})

test('примеры из интерфейса валидны', () => {
  const { list, errors } = parseAutomations(JSON.stringify({ automations: EXAMPLES.map((e) => e.rec) }))
  assert.deepEqual(errors, [])
  assert.equal(list.length, EXAMPLES.length)
})
