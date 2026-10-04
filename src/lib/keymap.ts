/* Настраиваемые горячие клавиши. Сочетание хранится как «Mod+Shift+Y»; клавиша берётся из e.code, поэтому работает и в русской раскладке. */
export interface KeyAction {
  id: string
  label: string
  def: string
  ws?: boolean
}

export const ACTIONS: KeyAction[] = [
  { id: 'palette', label: 'Палитра команд', def: 'Mod+K' },
  { id: 'files', label: 'Найти файл', def: 'Mod+P', ws: true },
  { id: 'goto', label: 'Перейти к строке', def: 'Mod+G', ws: true },
  { id: 'today', label: 'Сегодня', def: 'Mod+Shift+Y', ws: true },
  { id: 'replace', label: 'Найти и заменить в проекте', def: 'Mod+Shift+H', ws: true },
  { id: 'git', label: 'Панель Git', def: 'Mod+Shift+G', ws: true },
  { id: 'search', label: 'Поиск по содержимому', def: 'Mod+Shift+F', ws: true },
  { id: 'newchat', label: 'Новый чат', def: 'Mod+Shift+A', ws: true },
  { id: 'newtask', label: 'Новая задача', def: 'Mod+Shift+T', ws: true },
  { id: 'term', label: 'Терминал', def: 'Mod+`', ws: true },
  { id: 'dock', label: 'Нижняя панель', def: 'Mod+J', ws: true },
  { id: 'pipeline', label: 'Запустить пайплайн', def: 'Mod+Shift+R', ws: true },
  { id: 'project', label: 'Сменить проект', def: 'Mod+O', ws: true },
  { id: 'side', label: 'Показать / скрыть сайдбар', def: 'Mod+B', ws: true },
  { id: 'settings', label: 'Настройки', def: 'Mod+,' },
  { id: 'design', label: 'Режим дизайна', def: 'Mod+Shift+D', ws: true },
  { id: 'shortcuts', label: 'Горячие клавиши', def: 'Mod+/' },
]

/** системные сочетания, которые нельзя занимать: копирование, вставка, отмена, сохранение… */
const RESERVED = new Set([
  'Mod+C',
  'Mod+V',
  'Mod+X',
  'Mod+A',
  'Mod+Z',
  'Mod+Shift+Z',
  'Mod+Y',
  'Mod+S',
  'Mod+W',
  'Mod+F',
  'Mod+Q',
  'Mod+R',
  'Mod+L',
  'Mod+N',
  'Mod+T',
])

const CODE_KEYS: Record<string, string> = {
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backslash: '\\',
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
}

export function keyOf(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-2])$/.test(code)) return code
  return CODE_KEYS[code] ?? null
}

export interface KeyLike {
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export function comboOf(e: KeyLike): string | null {
  const k = keyOf(e.code)
  if (!k) return null
  const parts = [(e.ctrlKey || e.metaKey) && 'Mod', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(
    Boolean,
  ) as string[]
  return [...parts, k].join('+')
}

export type KeyMap = Record<string, string>
export const effective = (custom?: KeyMap): KeyMap =>
  Object.fromEntries(ACTIONS.map((a) => [a.id, custom?.[a.id] || a.def]))

/** какое действие вызывает это событие (если есть) */
export function actionFor(e: KeyLike, map: KeyMap): KeyAction | null {
  const c = comboOf(e)
  if (!c) return null
  return ACTIONS.find((a) => map[a.id] === c) ?? null
}

/** можно ли назначить; возвращает причину отказа или null */
export function check(map: KeyMap, id: string, combo: string): string | null {
  if (!/(^|\+)(Mod|Alt)\+/.test(combo))
    return 'Нужен Ctrl (или Alt), иначе сочетание будет срабатывать при наборе текста'
  if (RESERVED.has(combo)) return 'Это сочетание занято системой или редактором'
  const other = ACTIONS.find((a) => a.id !== id && map[a.id] === combo)
  return other ? `Уже используется: «${other.label}»` : null
}

/** части для показа: ['Ctrl','Shift','Y'] */
export const parts = (combo: string, mod: string) => combo.split('+').map((p) => (p === 'Mod' ? mod : p))

/** короткая подсказка для палитры: «Ctrl ⇧ Y» */
export const hintOf = (id: string, mod: string, custom?: KeyMap) =>
  parts(effective(custom)[id], mod)
    .map((x) => (x === 'Shift' ? '⇧' : x))
    .join(' ')
