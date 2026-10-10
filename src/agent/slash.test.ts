import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseFrontmatter,
  listSkills,
  listCustom,
  expandTemplate,
  parseSlash,
  parseLoop,
  loopDone,
  loopPrompt,
  suggest,
  skillsIndex,
} from './slash'
import { decide } from './loop'

test('шапка: ключи, кавычки, многострочное описание, без шапки', () => {
  const r = parseFrontmatter('---\nname: x\ndescription: "Делает **это**"\nlong: >\n  раз\n  два\n---\nТекст')
  assert.equal(r.meta.name, 'x')
  assert.equal(r.meta.description, 'Делает **это**')
  assert.equal(r.meta.long, 'раз два')
  assert.equal(r.body, 'Текст')
  assert.equal(parseFrontmatter('просто текст').body, 'просто текст')
  assert.deepEqual(parseFrontmatter('---\nбез закрытия').meta, {})
})

test('навыки: .tetra приоритетнее .claude, имя из шапки, мусор отбрасывается', () => {
  const files = {
    '.tetra/skills/pdf/SKILL.md': '---\ndescription: Работа с PDF\n---\nшаги',
    '.claude/skills/pdf/SKILL.md': '---\ndescription: другое\n---\nx',
    '.claude/skills/dir1/SKILL.md': '---\nname: красиво\n---\nx',
    '.claude/skills/with space/SKILL.md': 'x',
    '.tetra/skills/pdf/notes.md': 'не навык',
  }
  const s = listSkills(files)
  assert.deepEqual(s.map((x) => x.name).sort(), ['pdf', 'красиво'].sort())
  assert.equal(s.find((x) => x.name === 'pdf')!.description, 'Работа с PDF')
  assert.match(skillsIndex(files), /pdf: Работа с PDF — <read path=".tetra\/skills\/pdf\/SKILL.md" \/>/)
})

test('свои команды: вложенность, не перекрывают встроенные', () => {
  const files = {
    '.tetra/commands/fix.md': '---\ndescription: Чинить\nargument-hint: <баг>\n---\nПочини $ARGUMENTS',
    '.tetra/commands/git/pr.md': 'Опиши PR',
    '.tetra/commands/loop.md': 'подмена',
    '.claude/commands/fix.md': 'дубль',
  }
  const c = listCustom(files)
  assert.deepEqual(c.map((x) => x.name).sort(), ['fix', 'git:pr'])
  assert.equal(c.find((x) => x.name === 'fix')!.hint, '<баг>')
})

test('шаблон: $ARGUMENTS, $1, дописывание аргументов', () => {
  assert.equal(expandTemplate('Почини $ARGUMENTS!', 'баг в login'), 'Почини баг в login!')
  assert.equal(expandTemplate('a=$1 b=$2', 'x "y z"'), 'a=x b=y z')
  assert.match(expandTemplate('Без плейсхолдера', 'вот'), /Без плейсхолдера\n\nАргументы: вот/)
  assert.equal(expandTemplate('Без аргументов', ''), 'Без аргументов')
})

test('parseSlash: команды и не-команды', () => {
  assert.deepEqual(parseSlash('/loop x3 дело'), { name: 'loop', args: 'x3 дело' })
  assert.deepEqual(parseSlash('  /help '), { name: 'help', args: '' })
  assert.equal(parseSlash('/src/app.ts поправь'), null)
  assert.equal(parseSlash('привет /loop'), null)
  assert.equal(parseSlash('/'), null)
  assert.deepEqual(parseSlash('/релиз 2.14'), { name: 'релиз', args: '2.14' })
})

test('parseLoop: число, пауза, бесконечность, ошибки', () => {
  assert.deepEqual(parseLoop('x5 каждые 10m разбери TODO'), { task: 'разбери TODO', max: 5, gap: 600000 })
  assert.equal(parseLoop('3 раза дело').max, 3)
  assert.equal(parseLoop('∞ дело').max, 0)
  assert.equal(parseLoop('дело без числа').max, 0)
  assert.equal(parseLoop('every 1s дело').gap, 2000)
  assert.ok(parseLoop('').error)
  assert.ok(parseLoop('x5').error)
  assert.ok(parseLoop('x9999 дело').error)
  assert.equal(parseLoop('x2 дело про x5 раз').task, 'дело про x5 раз')
})

test('LOOP_DONE: только отдельным маркером', () => {
  assert.ok(loopDone('Всё сделано.\nLOOP_DONE'))
  assert.ok(loopDone('готово LOOP_DONE.'))
  assert.ok(!loopDone('напиши LOOP_DONE когда закончишь, пока рано'))
  assert.match(loopPrompt('t', 2, 5), /проход 2 из 5/)
})

test('decide: причины остановки цикла', () => {
  assert.equal(decide({ n: 1, max: 0, same: 0 }, 'ok', false), null)
  assert.match(decide({ n: 1, max: 0, same: 0 }, 'ok', true)!, /ошибка/)
  assert.match(decide({ n: 1, max: 0, same: 0 }, 'LOOP_DONE', false)!, /достигнута/)
  assert.match(decide({ n: 3, max: 3, same: 0 }, 'ok', false)!, /все 3/)
  assert.match(decide({ n: 2, max: 0, same: 3 }, 'ok', false)!, /одинаковых/)
})

test('подсказки: по префиксу, без дублей, навыки и свои', () => {
  const files = { '.tetra/commands/lint.md': 'x', '.tetra/skills/log/SKILL.md': 'x' }
  assert.deepEqual(
    suggest(files, '/lo')
      .map((x) => x.name)
      .slice(0, 2),
    ['loop', 'log'],
  )
  assert.equal(suggest(files, '/li')[0].name, 'lint')
  assert.equal(suggest(files, 'нет').length, 0)
  assert.ok(suggest({}, '/').length >= 8)
  assert.equal(suggest({}, '/loop дело').length, 0)
})
