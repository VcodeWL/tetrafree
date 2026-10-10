import type { IconName } from './components/ui/iconData'

export type ID = string

export interface Person {
  id: ID
  name: string
  initials: string
  email: string
  hue: number
  avatar?: string
  pending?: boolean
  role?: string
  tz?: string
  tags?: string[]
  status?: 'online' | 'away' | 'offline'
}

export interface Memory {
  id: ID
  text: string
  by: string
  chatId?: ID
  chat?: string
  at: number
  kind: 'decision' | 'fact'
}

export type Tier = 'Тихо' | 'Уведомить' | 'Спросить' | 'Эскалация'
export const TIERS: Tier[] = ['Тихо', 'Уведомить', 'Спросить', 'Эскалация']

export interface ChatAgent {
  name: string
  tier: Tier
  sub: string[]
}

export type Actor = { kind: 'human'; id: ID } | { kind: 'agent'; name: string }

export interface Attachment {
  id: ID
  name: string
  size: number
  mime: string
  url?: string
}

export interface PlanItem {
  k: string
  state: 'wait' | 'active' | 'done'
}

export type Message =
  | { id: ID; kind: 'sys'; text: string; at: number; reset?: boolean }
  | {
      id: ID
      kind: 'human'
      author: ID
      text: string
      attachments?: Attachment[]
      at: number
      pinned?: boolean
    }
  | {
      id: ID
      kind: 'agent'
      agent: string
      tier?: Tier
      text: string
      at: number
      streaming?: boolean
      thinking?: string
      model?: string
      error?: boolean
      parts?: Part[]
      startedAt?: number
      firstAt?: number
      endedAt?: number
      chars?: number
      reasoning?: string
      turn?: TurnChanges
      stopped?: boolean
      /** оценка токенов хода (живая модель): вход и выход */
      usage?: { inTok: number; outTok: number; steps: number; mid?: string; free?: boolean }
    }

/* Живые части ответа агента: текст, шаги, операции над файлами, команды */
export type FileOp = 'create' | 'edit' | 'delete' | 'rename'
export type FileState = 'writing' | 'done' | 'error' | 'proposed' | 'rejected' | 'reverted'
/** at — когда часть появилась (мс, Date.now()); нужен для воспроизведения хода */
export type Part = PartBody & { at?: number }
type PartBody =
  | { k: 'text'; id: ID; text: string }
  | { k: 'step'; id: ID; text: string; done?: boolean }
  | {
      k: 'file'
      id: ID
      op: FileOp
      path: string
      to?: string
      state: FileState
      add: number
      del: number
      lines?: number
      before?: string | null
      after?: string | null
      error?: string
    }
  | {
      k: 'cmd'
      id: ID
      cmd: string
      state: 'running' | 'done' | 'error'
      out: string
      code?: number
      real?: boolean
    }
  | { k: 'read'; id: ID; path: string; ok: boolean }
export interface TurnChanges {
  state: 'applied' | 'proposed' | 'reverted' | 'rejected' | 'partial'
  version?: number
  files: number
  add: number
  del: number
}

export interface Chat {
  id: ID
  title: string
  creator: Actor
  agents: ChatAgent[]
  running: boolean
  messages: Message[]
  createdAt: number
  lastAt: number
  unread?: boolean
  /** закреплён вверху списка */
  pinned?: boolean
}

export type BlockType = 'p' | 'h2' | 'todo' | 'code' | 'callout' | 'quote' | 'li' | 'table' | 'image'
export interface Block {
  id: ID
  type: BlockType
  /** для image — подпись; для table не используется (см. rows) */
  text: string
  checked?: boolean
  /** уровень вложенности пункта списка, 0..3 */
  indent?: number
  /** таблица: первая строка — заголовок */
  rows?: string[][]
  /** картинка: data: URL (уже уменьшенная) */
  src?: string
}
export interface Doc {
  id: ID
  title: string
  createdBy: ID
  updatedAt: number
  blocks: Block[]
  /** файл-зеркало в проекте: docs/<название>.md */
  file?: string
}

export type TaskStatus = 'backlog' | 'doing' | 'review' | 'done'
export type Priority = 'low' | 'med' | 'high'
export interface Task {
  id: ID
  key: number
  title: string
  desc: string
  status: TaskStatus
  assignee: Actor | null
  priority: Priority
  start?: string
  due?: string
  createdAt: number
  updatedAt?: number
  /** чек-лист внутри задачи */
  subtasks?: { id: ID; text: string; done: boolean }[]
  /** метки: «баг», «дизайн»… */
  labels?: string[]
  /** обсуждение задачи */
  comments?: { id: ID; by: ID; text: string; at: number }[]
  /** повтор: при завершении создаётся следующая копия */
  repeat?: 'daily' | 'weekdays' | 'weekly' | 'monthly'
  /** задачи, которые должны быть готовы раньше этой */
  blockedBy?: ID[]
}

export interface Version {
  id?: ID
  n: number
  title: string
  at: number
  by: 'human' | 'agent'
  author: string
  tag: 'build' | 'release'
  feats: string[]
  changes: string[]
  fixes: string[]
  details: string[]
  snapshot: Record<string, string>
}

export interface DeployStep {
  name: string
  detail: string
  state: 'wait' | 'run' | 'ok' | 'fail'
}
export interface DeployRun {
  id: ID
  kind: 'release' | 'preview'
  version: number
  at: number
  status: 'running' | 'ok' | 'failed'
  steps: DeployStep[]
  log: string[]
  pipeline?: string
  /** кто запустил (имя) — видно коллегам по команде */
  by?: string
}

export interface Lane {
  id: ID
  who: string
  chatId?: ID
  chat: string
  lease: string
  mode: 'write' | 'read'
  act: string
  pct: number
  subs: string[]
}

export interface Project {
  id: ID
  /** после каждой новой версии отправлять коммиты на удалённый репозиторий (зеркало) */
  mirror?: boolean
  /** закреплён вверху списка проектов */
  pinned?: boolean
  name: string
  path: string
  desc: string
  icon: IconName
  members: ID[]
  creator: ID
  createdAt: number
  openedAt: number
  template: string
  tools: string[]
  chats: Chat[]
  docs: Doc[]
  tasks: Task[]
  taskSeq: number
  files: Record<string, string>
  /** сохранённые виды задач */
  taskViews?: {
    id: ID
    name: string
    f: { who: 'all' | 'me' | 'agents'; q: string; label: string | null; late: boolean }
  }[]
  /** удалённые файлы, 30 дней */
  trash?: { path: string; content: string; at: number }[]
  dirs: string[]
  versions: Version[]
  deploy: { auto: boolean; runs: DeployRun[] }
  lanes: Lane[]
  memory: Memory[]
  /** облачный (командный) проект: общий снимок на сервере */
  cloud?: {
    pid: string
    rev: number
    owner: boolean
    ownerId: string
    /** надгробия: id удалённого документа/задачи/чата/заметки → когда удалили (чтобы слияние не воскрешало удалённое) */
    tomb?: Record<string, number>
    /** общая лента версий команды (без снимков) */
    team?: TeamEntry[]
  }
  /** комментарии к строкам кода (синхронизируются в команде) */
  comments?: LineComment[]
}

export interface LineComment {
  id: ID
  file: string
  line: number
  anchor: string
  text: string
  by: ID
  at: number
  done?: boolean
}
export type TeamEntry = Omit<Version, 'snapshot' | 'n'> & { id: ID; n?: number }

export type ProviderKind = 'anthropic' | 'openai' | 'ollama' | 'custom'
export interface Provider {
  id: ID
  name: string
  kind: ProviderKind
  baseUrl: string
  apiKey: string
  models: { id: string; name: string }[]
  on: boolean
}

export interface Settings {
  showOnline: boolean
  notifyEscalations: boolean
  osNotify?: boolean
  /** при запуске десктопа сначала проверять и ставить обновления (по умолчанию включено) */
  autoUpdate?: boolean
  accents: boolean
  ambient: boolean
  reducedMotion: boolean
  enterToSend: boolean
  followAgent?: boolean
  backendUrl?: string
  backendSync?: boolean
  /** внешний редактор кода по умолчанию (id из списка установленных) */
  editor?: string
  /** полный путь к своему редактору (портативная установка, нестандартная папка) */
  editorPath?: string
  /** вход без аккаунта (сервер недоступен) */
  localMode?: boolean
  hideOnboarding?: boolean
  /** тема интерфейса */
  theme?: 'dark' | 'light' | 'system'
  /** после правок агента запускать проверку проекта (typecheck/lint/test) и один раз просить исправить */
  autoVerify?: boolean
  /** последняя версия приложения, о которой пользователь уже узнал («Что нового») */
  seenVersion?: string
  /** плотность интерфейса */
  density?: 'comfortable' | 'compact'
  /** размер шрифта кода, px */
  codeSize?: 11.5 | 12.5 | 14
  uiFont?: string
  /** свои горячие клавиши: id действия → «Mod+Shift+Y» */
  keys?: Record<string, string>
  codeFont?: string
  /** лимит расходов на модели за календарный месяц, USD; пусто/0 — без лимита */
  budget?: number
  /** раз в сутки класть резервную копию на диск (по умолчанию включено) */
  autoBackup?: boolean
  /** характер акцентов: градиент (по умолчанию) или спокойный */
  look?: 'calm' | 'gradient'
  /** свои цены за 1 млн токенов по id модели */
  priceCustom?: Record<string, { inp: number; out: number }>
}

export type Center =
  { kind: 'empty' } | { kind: 'chat'; id: ID } | { kind: 'doc'; id: ID } | { kind: 'tasks' }
