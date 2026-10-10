/* Слэш-команды и навыки. Всё лежит файлами в проекте — их можно коммитить и делить с командой:
     .tetra/commands/<имя>.md          своя команда: /<имя> аргументы   (также читаем .claude/commands и .opencode/command)
     .tetra/skills/<имя>/SKILL.md      навык: инструкция на случай «когда нужно X» (также .claude/skills, .agents/skills)
   Формат файла — как у Claude Code: необязательная шапка `---` с `description:`, дальше текст.
   В тексте команды: $ARGUMENTS — всё, что написано после имени; $1…$9 — отдельные слова. */

export interface Frontmatter {
  meta: Record<string, string>
  body: string
}

/** Шапка `---` с простыми строками `ключ: значение` (кавычки и `>`/`|` с продолжением тоже понимаем) */
export function parseFrontmatter(src: string): Frontmatter {
  const text = src.replace(/^\uFEFF/, '')
  const m = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!m) return { meta: {}, body: text }
  const meta: Record<string, string> = {}
  const lines = m[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([\w-]+)\s*:\s*(.*)$/)
    if (!kv) continue
    let v = kv[2].trim()
    if (/^[>|][+-]?$/.test(v)) {
      const parts: string[] = []
      while (i + 1 < lines.length && /^\s+\S|^\s*$/.test(lines[i + 1])) parts.push(lines[++i].trim())
      v = parts.join(v.startsWith('>') ? ' ' : '\n').trim()
    } else if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1)
    meta[kv[1]] = v
  }
  return { meta, body: text.slice(m[0].length) }
}

export interface Skill {
  name: string
  description: string
  path: string
  dir: string
  body: string
}
export interface Custom {
  name: string
  description: string
  hint: string
  path: string
  body: string
}

const SKILL_DIRS = ['.tetra/skills', '.claude/skills', '.agents/skills']
const CMD_DIRS = ['.tetra/commands', '.claude/commands', '.opencode/command']
const NAME = /^[\p{L}\p{N}_][\p{L}\p{N}_.:-]{0,47}$/u

export function listSkills(files: Record<string, string>): Skill[] {
  const out = new Map<string, Skill>()
  for (const d of SKILL_DIRS)
    for (const path of Object.keys(files).sort()) {
      const m = path.match(new RegExp('^' + d.replace('.', '\\.') + '/([^/]+)/SKILL\\.md$'))
      if (!m) continue
      const { meta, body } = parseFrontmatter(files[path])
      const name = (meta.name || m[1]).trim()
      if (!NAME.test(name) || out.has(name)) continue
      out.set(name, {
        name,
        description: (meta.description || firstLine(body)).slice(0, 300),
        path,
        dir: path.slice(0, -'/SKILL.md'.length),
        body,
      })
    }
  return [...out.values()]
}

export function listCustom(files: Record<string, string>): Custom[] {
  const out = new Map<string, Custom>()
  for (const d of CMD_DIRS)
    for (const path of Object.keys(files).sort()) {
      if (!path.startsWith(d + '/') || !path.endsWith('.md')) continue
      const name = path.slice(d.length + 1, -3).replace(/\//g, ':')
      if (!NAME.test(name) || out.has(name) || BUILTIN_NAMES.has(name)) continue
      const { meta, body } = parseFrontmatter(files[path])
      out.set(name, {
        name,
        description: (meta.description || firstLine(body)).slice(0, 200),
        hint: meta['argument-hint'] || meta.argument_hint || '',
        path,
        body,
      })
    }
  return [...out.values()]
}

function firstLine(s: string) {
  return (
    s
      .split(/\r?\n/)
      .map((l) => l.replace(/^#+\s*/, '').trim())
      .find(Boolean) || ''
  )
}

/** Подставляет аргументы. Без плейсхолдеров аргументы дописываются в конец — они не должны пропасть. */
export function expandTemplate(body: string, args: string): string {
  const words = args.match(/"[^"]*"|'[^']*'|\S+/g)?.map((w) => w.replace(/^(["'])(.*)\1$/, '$2')) || []
  let used = false
  const out = body
    .replace(/\$ARGUMENTS\b/g, () => {
      used = true
      return args
    })
    .replace(/\$([1-9])\b/g, (_, n) => {
      used = true
      return words[+n - 1] ?? ''
    })
  return !used && args.trim() ? `${out.trimEnd()}\n\nАргументы: ${args}` : out
}

/* ------------------------------------------------------------------ встроенные команды */

export interface Builtin {
  name: string
  hint: string
  desc: string
  /** шаблон запроса к агенту — команда лишь подставляет его; остальные команды исполняет приложение */
  prompt?: string
}

export const BUILTINS: Builtin[] = [
  {
    name: 'loop',
    hint: '[x5] [каждые 10m] задача',
    desc: 'Повторять задачу сам, пока она не будет готова (или пока не нажмёшь «Стоп»)',
  },
  {
    name: 'match',
    hint: '[97%] [x20] [файл.html] — приложи скриншот',
    desc: 'Подгонять вёрстку под приложенный скриншот, пока не совпадёт',
  },
  {
    name: 'autopilot',
    hint: '[баги тесты визуал…] [каждые 10m]',
    desc: 'Агент сам придумывает улучшения и делает их, пока не нажмёшь «Стоп»',
  },
  { name: 'stop', hint: '', desc: 'Остановить агента и цикл /loop' },
  { name: 'help', hint: '', desc: 'Список команд и навыков этого проекта' },
  { name: 'clear', hint: '', desc: 'Начать с чистого контекста: агент забудет прошлую переписку этого чата' },
  { name: 'memory', hint: 'текст', desc: 'Запомнить решение в общей памяти проекта' },
  { name: 'model', hint: '', desc: 'Какая модель отвечает сейчас, и выбор другой' },
  { name: 'mcp', hint: '', desc: 'Подключённые MCP-серверы и их инструменты' },
  { name: 'market', hint: 'запрос', desc: 'Каталог: навыки, команды, MCP-серверы и наборы в один клик' },
  { name: 'skills', hint: '', desc: 'Навыки проекта' },
  { name: 'skill', hint: 'имя [аргументы]', desc: 'Применить навык к задаче' },
  {
    name: 'plan',
    hint: 'задача',
    desc: 'Только план, без правок',
    prompt:
      'Составь план для задачи ниже. НЕ меняй файлы и НЕ запускай команды: только пронумерованные шаги, затронутые файлы, риски и вопросы, если что-то неясно. Дождись моего «да».\n\nЗадача: $ARGUMENTS',
  },
  {
    name: 'review',
    hint: '[что смотреть]',
    desc: 'Ревью текущих правок (git diff)',
    prompt:
      'Сделай ревью моих текущих изменений (git diff). Ищи баги, пропущенные граничные случаи, проблемы безопасности и несоответствие правилам проекта. Ничего не правь — перечисли находки по важности, с файлом и строкой. $ARGUMENTS',
  },
  {
    name: 'audit',
    hint: '[область]',
    desc: 'Полный аудит проекта: баги, безопасность, качество — отчёт в docs/AUDIT.md',
    prompt:
      'Проведи аудит проекта как строгий критик. Прочитай ключевые файлы (<read>), при необходимости запусти тесты/сборку. Проверь: баги и граничные случаи, безопасность (ввод, секреты, пути, зависимости), качество и повторы кода, тесты, документацию. Запиши отчёт в docs/AUDIT.md: находки по важности (критично / важно / мелочи) с файлом и строкой и конкретным способом исправить. Код не меняй — только отчёт. Область: $ARGUMENTS',
  },
  {
    name: 'test',
    hint: '[что покрыть]',
    desc: 'Написать тесты и прогнать их',
    prompt:
      'Напиши тесты для кода ниже в стиле уже существующих тестов проекта, затем запусти их командой проекта и поправь, если падают. Что покрыть: $ARGUMENTS',
  },
  {
    name: 'explain',
    hint: 'файл или вопрос',
    desc: 'Объяснить код, ничего не меняя',
    prompt:
      'Объясни, как это устроено: $ARGUMENTS\nФайлы не меняй. Сначала прочитай нужные файлы (<read>), потом отвечай коротко и со ссылками на пути.',
  },
  {
    name: 'init',
    hint: '',
    desc: 'Создать AGENTS.md — инструкции проекта для агентов',
    prompt:
      'Изучи проект (дерево файлов, package.json/README, ключевые исходники — читай через <read>) и создай в корне файл AGENTS.md: что это за проект, как запускать/собирать/тестировать, структура папок, правила кода и ловушки. Только то, что реально видно в проекте, ничего не выдумывай. Если AGENTS.md уже есть — аккуратно дополни его через <edit>. $ARGUMENTS',
  },
]
export const BUILTIN_NAMES = new Set(BUILTINS.map((b) => b.name))

/* ------------------------------------------------------------------ разбор ввода */

/** «/имя аргументы» → { name, args }. Пути вроде «/src/app.ts» командой не считаются. */
export function parseSlash(text: string): { name: string; args: string } | null {
  const m = text.trim().match(/^\/([\p{L}\p{N}_][\p{L}\p{N}_.:-]*)(?:\s+([\s\S]*))?$/u)
  return m ? { name: m[1], args: (m[2] || '').trim() } : null
}

export interface LoopSpec {
  task: string
  /** сколько раз; 0 = без ограничения */
  max: number
  /** пауза между итерациями, мс */
  gap: number
  error?: string
}

const UNIT: Record<string, number> = { s: 1e3, с: 1e3, m: 6e4, м: 6e4, h: 36e5, ч: 36e5 }
export const LOOP_MIN_GAP = 2000
export const LOOP_MAX = 500

/** `/loop x5 каждые 10m задача`, `/loop 3 раза задача`, `/loop ∞ задача`; без числа — до готовности */
export function parseLoop(args: string): LoopSpec {
  let rest = args.trim()
  let max = 0,
    gap = LOOP_MIN_GAP
  for (let guard = 0; guard < 4; guard++) {
    let m: RegExpMatchArray | null
    if (
      (m = rest.match(/^(?:x|х|×)\s?(\d{1,4})(?=\s|$)\s*/i)) ||
      (m = rest.match(/^(\d{1,4})\s?(?:×|x|х|раз[а]?)(?=\s|$)\s*/i))
    )
      max = +m[1]
    else if ((m = rest.match(/^(?:∞|inf|infinite|бесконечно)(?=\s|$)\s*/i))) max = 0
    else if ((m = rest.match(/^(?:every|каждые|каждую|раз в)\s+(\d{1,5})\s?([smhсмч])\w*(?=\s|$)\s*/i)))
      gap = Math.max(LOOP_MIN_GAP, +m[1] * UNIT[m[2].toLowerCase()])
    else break
    rest = rest.slice(m[0].length)
  }
  if (!rest) return { task: '', max, gap, error: 'Напиши задачу: `/loop x5 разбери все TODO в коде`' }
  if (max > LOOP_MAX) return { task: rest, max, gap, error: `Не больше ${LOOP_MAX} повторов (или без числа)` }
  return { task: rest, max, gap }
}

export const LOOP_DONE = 'LOOP_DONE'

/** Запрос к агенту на очередной проход */
export function loopPrompt(task: string, n: number, max: number): string {
  return `[/loop · проход ${n}${max ? ' из ' + max : ''}] Задача: ${task}

Сделай следующий осмысленный шаг к цели, не повторяя уже сделанное (посмотри свои прошлые ответы и состояние файлов). Если цель полностью достигнута и делать больше нечего — коротко подведи итог и напиши отдельной строкой ${LOOP_DONE}. Если застрял и нужен человек — объясни, чего не хватает, и тоже напиши ${LOOP_DONE}.`
}

export const loopDone = (text: string) => new RegExp(`(^|\\s)${LOOP_DONE}\\s*[.!]?\\s*$`, 'm').test(text)

export function fmtGap(ms: number) {
  return ms >= 36e5
    ? `${+(ms / 36e5).toFixed(1)} ч`
    : ms >= 6e4
      ? `${+(ms / 6e4).toFixed(1)} мин`
      : `${Math.round(ms / 1e3)} с`
}

/* ------------------------------------------------------------------ подсказки при вводе «/» */

export interface Suggest {
  name: string
  hint: string
  desc: string
  kind: 'builtin' | 'custom' | 'skill'
}

export function suggest(files: Record<string, string>, draft: string): Suggest[] {
  const m = draft.match(/^\/([\p{L}\p{N}_.:-]*)$/u)
  if (!m) return []
  const q = m[1].toLowerCase()
  const all: Suggest[] = [
    ...BUILTINS.map((b) => ({ name: b.name, hint: b.hint, desc: b.desc, kind: 'builtin' as const })),
    ...listCustom(files).map((c) => ({
      name: c.name,
      hint: c.hint,
      desc: c.description,
      kind: 'custom' as const,
    })),
    ...listSkills(files).map((s) => ({
      name: s.name,
      hint: '',
      desc: s.description,
      kind: 'skill' as const,
    })),
  ]
  const seen = new Set<string>()
  return all
    .filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)))
    .filter((s) => s.name.toLowerCase().includes(q))
    .sort((a, b) => +!a.name.toLowerCase().startsWith(q) - +!b.name.toLowerCase().startsWith(q))
    .slice(0, 8)
}

/** Список навыков для системной инструкции: агент сам решает, когда прочитать SKILL.md */
export function skillsIndex(files: Record<string, string>): string {
  const s = listSkills(files).slice(0, 30)
  if (!s.length) return ''
  return s
    .map((k) => `- ${k.name}: ${k.description || '(без описания)'} — <read path="${k.path}" />`)
    .join('\n')
}

/* ------------------------------------------------------------------ заготовки для новых команд и навыков */

export const validExtName = (n: string) => NAME.test(n) && !BUILTIN_NAMES.has(n)

export function commandTemplate(name: string): { path: string; text: string } {
  return {
    path: `.tetra/commands/${name.replace(/:/g, '/')}.md`,
    text: `---
description: Что делает команда /${name} (одна строка — её видно в подсказках)
argument-hint: <что передать>
---
Опиши здесь, что должен сделать агент. Аргументы после имени команды: $ARGUMENTS

Критерии «готово»:
- …
`,
  }
}

export function skillTemplate(name: string): { path: string; text: string } {
  return {
    path: `.tetra/skills/${name}/SKILL.md`,
    text: `---
name: ${name}
description: Когда применять этот навык (агент читает это описание в каждом ходе и решает, нужен ли навык). Например: «Работа с PDF — извлечь текст, склеить, разрезать»
---
# ${name}

1. Первый шаг…
2. Второй шаг…

Ловушки: …
`,
  }
}
