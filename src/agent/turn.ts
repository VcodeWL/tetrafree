/* Один ход агента: живые части сообщения, применение изменений к проекту, итог хода */
import type { FileOp, ID, Lane, Message, Part, Tier, TurnChanges } from '../types'
import { fireTrigger } from './ci'
import { tally } from './turnPolicy'
export { tally } from './turnPolicy'
import { diffStat } from '../lib/diff'
import { live } from './live'
import { useStore, getChat, toast } from '../store'
import { fileOf, base, putFile, countLines } from './projectfs'
import { image, sameImage, type GuardedFile, type FileImage } from './fileguard'

const S = () => useStore.getState()

const MAX_PROPOSE = 300_000

/* ------------------------------------------------------------------ Turn */

export class Turn {
  parts: Part[] = []
  before = new Map<string, string | null>()
  after = new Map<string, string | null>()
  done = new Set<string>() // id частей, которые уже применены
  chars = 0
  reasoning = ''
  private timer: ReturnType<typeof setInterval> | null = null
  private dirty = false
  firstAt = 0
  private baselines = new Map<ID, FileImage>()
  private editInputs = new Map<ID, string>()
  private proposalDependencies = new Set<ID>()
  constructor(
    public pid: ID,
    public chatId: ID,
    public msgId: ID,
    public agent: string,
    public tier: Tier,
    public laneId: ID,
    public ctl: AbortController,
    public current: () => boolean = () => true,
  ) {
    this.timer = setInterval(() => this.flush(), 60)
  }
  get aborted() {
    return this.ctl.signal.aborted || !this.current()
  }
  guard() {
    if (this.aborted) throw new DOMException('Ход отменён', 'AbortError')
  }
  patch(p: Partial<Message>) {
    S().patchMsg(this.chatId, this.msgId, p, this.pid)
  }
  lane(patch: Partial<Lane>) {
    S().setLanes((l) => l.map((x) => (x.id === this.laneId ? { ...x, ...patch } : x)), this.pid)
  }
  touch() {
    this.dirty = true
  }
  flush(force = false) {
    if (!this.dirty && !force) return
    this.dirty = false
    const text = this.parts
      .filter((p) => p.k === 'text')
      .map((p) => (p as Extract<Part, { k: 'text' }>).text)
      .join('\n\n')
    this.patch({
      parts: this.parts.map((p) => ({ ...p })),
      text,
      chars: this.chars,
      reasoning: this.reasoning || undefined,
    } as Partial<Message>)
  }
  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
  part<K extends Part['k']>(id: ID): Extract<Part, { k: K }> | undefined {
    return this.parts.find((p) => p.id === id) as never
  }
  upsert(p: Part) {
    const i = this.parts.findIndex((x) => x.id === p.id)
    if (i < 0) this.parts.push(p.at ? p : { ...p, at: Date.now() })
    else this.parts[i] = { ...this.parts[i], ...p } as Part
    this.touch()
  }
  mark(first = false) {
    if (!this.firstAt) {
      this.firstAt = Date.now()
      this.patch({ firstAt: this.firstAt, thinking: undefined })
      void first
    }
  }

  text(id: ID, text: string) {
    if (!text.trim()) return
    this.mark()
    this.upsert({ k: 'text', id, text })
  }
  step(id: ID, text: string) {
    /* предыдущие шаги считаются выполненными */
    this.parts = this.parts.map((p) => (p.k === 'step' && !p.done ? { ...p, done: true } : p))
    this.mark()
    this.upsert({ k: 'step', id, text })
    this.lane({ act: text.toLowerCase() })
  }
  closeSteps() {
    this.parts = this.parts.map((p) => (p.k === 'step' && !p.done ? { ...p, done: true } : p))
    this.touch()
  }

  follow(path: string) {
    if (this.aborted) return
    const st = S()
    if (st.settings.followAgent === false || st.projectId !== this.pid || st.mode !== 'dev') return
    if (st.activeFile !== path || !st.rightOpen || st.rightTab !== 'code') st.openFile(path)
  }

  /* ---- запись файла */
  begin(id: ID, op: FileOp, path: string, to?: string) {
    if (this.aborted) return
    this.baselines.set(id, image(this.pid, [path, ...(to ? [to] : [])]))
    this.mark()
    if (!this.before.has(path)) this.before.set(path, fileOf(this.pid, path) ?? null)
    const exists = fileOf(this.pid, path) !== undefined
    const real: FileOp = op === 'create' && exists ? 'edit' : op
    this.closeSteps()
    this.upsert({ k: 'file', id, op: real, path, to, state: 'writing', add: 0, del: 0, lines: 0 })
    if (real !== 'delete' && real !== 'rename') {
      live.start({
        pid: this.pid,
        path,
        text: real === 'edit' ? fileOf(this.pid, path) || '' : '',
        caret: 0,
        agent: this.agent,
        chatId: this.chatId,
        op: real,
      })
      this.follow(path)
    }
    this.lane({
      lease: path,
      mode: 'write',
      act: (real === 'create' ? 'создаёт ' : real === 'edit' ? 'правит ' : 'удаляет ') + base(path),
    })
  }
  /** Freeze computation input together with its CAS evidence, once per operation.
   * Applied operations use live text. Only an unaccepted proposal may supply a
   * virtual input, and its original before-image/approval requirement must follow. */
  beginEdit(id: ID, path: string): string | undefined {
    if (this.aborted) return
    if (this.editInputs.has(id)) return this.editInputs.get(id)
    const latest = [...this.parts]
      .reverse()
      .find((p): p is GuardedFile => p.k === 'file' && p.path === path && p.id !== id)
    const proposal =
      latest?.state === 'proposed' && (latest.op === 'create' || latest.op === 'edit') && latest.after != null
        ? latest
        : undefined
    const expected = proposal?.agentGuard?.before || image(this.pid, [path])
    const input = proposal ? proposal.after : expected[path]
    if (input == null) return
    this.begin(id, 'edit', path)
    this.baselines.set(id, { ...expected })
    this.editInputs.set(id, input)
    if (proposal) this.proposalDependencies.add(id)
    return input
  }

  progress(id: ID, path: string, text: string) {
    if (this.aborted) return
    live.set(this.pid, path, text)
    const f = this.part<'file'>(id)
    if (!f) return
    f.lines = countLines(text)
    f.add = f.op === 'create' ? f.lines : f.add
    this.touch()
  }
  /** Модель дописала файл. Применяем по политике автономности. */
  endWrite(id: ID, path: string, content: string) {
    if (this.aborted) return
    live.end(this.pid, path)
    const f = this.part<'file'>(id) as GuardedFile | undefined
    if (!f) return
    const baseline = this.baselines.get(id) || image(this.pid, [path])
    const before = baseline[path]
    const st = diffStat(before, content)
    const propose =
      this.tier === 'Эскалация' ||
      this.proposalDependencies.has(id) ||
      !sameImage(baseline, image(this.pid, [path]))
    this.after.set(path, content)
    if (content.length > MAX_PROPOSE) {
      f.state = 'error'
      f.error = 'Файл больше 300 КБ — не применяю'
      this.touch()
      return
    }
    Object.assign(f, {
      add: st.add,
      del: st.del,
      lines: countLines(content),
      before,
      after: content,
      agentGuard: { before: baseline, after: { [path]: content } },
      state: propose ? 'proposed' : 'done',
    })
    if (!propose) {
      putFile(this.pid, path, content)
      this.done.add(id)
    }
    this.touch()
  }
  endDelete(id: ID, path: string) {
    if (this.aborted) return
    const before = fileOf(this.pid, path) ?? null
    this.before.set(path, before)
    const propose = this.tier === 'Эскалация' || this.tier === 'Спросить'
    this.closeSteps()
    this.mark()
    this.after.set(path, null)
    this.upsert({
      k: 'file',
      id,
      op: 'delete',
      path,
      state: propose ? 'proposed' : 'done',
      add: 0,
      del: countLines(before || ''),
      lines: countLines(before || ''),
      before,
      after: null,
      agentGuard: { before: { [path]: before }, after: { [path]: null } },
    } as GuardedFile)
    if (!propose) {
      putFile(this.pid, path, null)
      this.done.add(id)
    }
  }
  endRename(id: ID, from: string, to: string) {
    if (this.aborted) return
    const src = fileOf(this.pid, from)
    this.mark()
    if (src === undefined) return this.fail(id, 'rename', from, 'Файла нет', to)
    if (fileOf(this.pid, to) !== undefined)
      return this.fail(id, 'rename', from, 'Файл ' + to + ' уже существует', to)
    this.before.set(from, src)
    this.before.set(to, null)
    this.after.set(from, null)
    this.after.set(to, src)
    const propose = this.tier === 'Эскалация' || this.tier === 'Спросить'
    this.upsert({
      k: 'file',
      id,
      op: 'rename',
      path: from,
      to,
      state: propose ? 'proposed' : 'done',
      add: 0,
      del: 0,
      lines: countLines(src),
      before: src,
      after: src,
      agentGuard: { before: { [from]: src, [to]: null }, after: { [from]: null, [to]: src } },
    } as GuardedFile)
    if (!propose) {
      putFile(this.pid, to, src)
      putFile(this.pid, from, null)
      this.done.add(id)
    }
  }
  fail(id: ID, op: FileOp, path: string, error: string, to?: string) {
    live.end(this.pid, path)
    this.mark()
    this.upsert({ k: 'file', id, op, path, to, state: 'error', add: 0, del: 0, error })
  }

  /** Итог: одна версия на ход */
  finish(summary: string): TurnChanges | undefined {
    this.stop()
    this.closeSteps()
    if (this.current()) live.endChat(this.chatId, this.pid)
    this.parts = this.parts.map((p) =>
      p.k === 'file' && p.state === 'writing'
        ? { ...p, state: 'error', error: 'Остановлено' }
        : p.k === 'cmd' && p.state === 'running'
          ? { ...p, state: 'error' }
          : p,
    )
    const files = this.parts.filter((p): p is Extract<Part, { k: 'file' }> => p.k === 'file')
    const applied = files.filter((f) => f.state === 'done'),
      proposed = files.filter((f) => f.state === 'proposed')
    if (!files.length) {
      this.flush(true)
      return undefined
    }
    let version: number | undefined
    if (applied.length)
      version = commitFiles(
        this.pid,
        this.chatId,
        this.agent,
        applied,
        summary,
        '',
        () => !this.ctl.signal.aborted,
      )
    const sum = tally(files)
    const ch: TurnChanges = {
      state: proposed.length
        ? applied.length
          ? 'partial'
          : 'proposed'
        : applied.length
          ? 'applied'
          : 'rejected',
      version,
      ...sum,
    }
    this.flush(true)
    this.patch({ turn: ch } as Partial<Message>)
    return ch
  }
}

export function commitFiles(
  pid: ID,
  chatId: ID,
  agent: string,
  files: Extract<Part, { k: 'file' }>[],
  summary: string,
  prefix = '',
  allowEffects: () => boolean = () => true,
) {
  const st = S()
  const title = (prefix + (summary.trim().split(/\n|(?<=[.!?])\s/)[0] || '')).replace(/[`*_#>]/g, '').trim()
  const names = files.map((f) => base(f.path))
  const t =
    title && title.length >= 6
      ? title.length > 56
        ? title.slice(0, 54) + '…'
        : title
      : prefix +
        (names.length > 2 ? `${names.slice(0, 2).join(', ')} и ещё ${names.length - 2}` : names.join(', '))
  const changes = files.map((f) =>
    f.op === 'create'
      ? `Создан ${f.path}`
      : f.op === 'delete'
        ? `Удалён ${f.path}`
        : f.op === 'rename'
          ? `Переименован ${f.path} → ${f.to}`
          : `Изменён ${f.path} (+${f.add} −${f.del})`,
  )
  const chatTitle = getChat(pid, chatId)?.title
  queueMicrotask(() => {
    if (allowEffects()) fireTrigger(pid, 'version')
  })
  const n = st.commit(
    {
      title: t,
      by: 'agent',
      author: agent,
      tag: 'build',
      feats: files.filter((f) => f.op === 'create').map((f) => 'Новый файл ' + f.path),
      changes: files.filter((f) => f.op !== 'create').map((f) => changes[files.indexOf(f)]),
      fixes: [],
      details: [`Сделал агент ${agent}`, `Файлов: ${files.length}`],
    },
    pid,
  )
  st.remember({ kind: 'decision', text: `${t} — v${n}`, by: agent, chatId, chat: chatTitle }, pid)
  const site = files.some((f) => f.path === 'site/index.html' && f.state === 'done')
  if (
    allowEffects() &&
    S().projectId === pid &&
    site &&
    S().mode === 'dev' &&
    S().settings.followAgent !== false
  )
    S().setRight({ rightOpen: true, rightTab: 'browser' })
  if (allowEffects())
    toast({
      title: `Версия v${n}`,
      desc: t,
      icon: 'check',
      tone: 'ok',
      action: { label: 'История', run: () => S().openModal({ type: 'versions', focus: n }) },
    })
  return n
}
