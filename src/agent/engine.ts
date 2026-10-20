/* Движок агента. Один ход (Turn) = одно сообщение агента, внутри которого живые части:
   текст, шаги, карточки файлов (создаёт / правит / удаляет), команды. Всё применяется к проекту
   по мере того, как модель пишет, и в конце собирается в одну версию. */
import { dequeue, peekQueue, enqueue, useQueue, clearQueue, queueGeneration } from './queue'
import {
  currentImage,
  image,
  pathsOf,
  recover,
  sameImage,
  type FileImage,
  type GuardedFile,
} from './fileguard'
import { dangerOf } from './danger'
import { Turn, tally, commitFiles } from './turn'
import { history, systemPrompt } from './prompt'
import { agentPathError } from '../lib/paths'
import { fileOf, putFile, expandDelete, countLines } from './projectfs'
import { diffStat } from '../lib/diff'
import { useStore, getChat, toast } from '../store'
import type { Attachment, ID, Message, Part, Tier, TurnChanges } from '../types'
import { uid } from '../lib/util'
import { streamChat, type ChatMsg } from './llm'
import { parseStream, cleanBody, parsePairs, applyPairs, summarizeForHistory, type Seg } from './protocol'
import { live } from './live'
import { backendOnline, bExec } from '../lib/backend'
import { osNotify } from '../lib/osnotify'
import { wantsGit, gitContext } from '../lib/gitctx'
import { report, costOf, fmtUsd, type Usage } from '../lib/usage'
import { loopStop, loopPassEnded, setLoopRunner } from './loop'
import { webFetchTool, webSearchTool, takeShotTool } from './webtools'
import { loadMcp, mcpSection, type McpAvail } from '../lib/mcp'
import { mcpAction } from './mcptool'

const S = () => useStore.getState()
const controllers = new Map<ID, AbortController>()
const queueTimers = new Map<ID, ReturnType<typeof setTimeout>>()
function cancelQueuedTimer(chatId: ID) {
  const timer = queueTimers.get(chatId)
  if (timer !== undefined) clearTimeout(timer)
  queueTimers.delete(chatId)
}
export const isRunning = (chatId: ID) => controllers.has(chatId) || queueTimers.has(chatId)
export function stopTurn(chatId: ID) {
  loopStop(chatId, 'остановлено вручную')
  cancelQueuedTimer(chatId)
  clearQueue(chatId)
  autoFix.delete(chatId)
  controllers.get(chatId)?.abort()
}

export function resolveModel() {
  const st = S()
  const [pid, mid] = st.model.split(/:(.+)/)
  const provider = st.providers.find((p) => p.id === pid && p.on)
  const model = provider?.models.find((m) => m.id === mid)
  const liveOk = !!provider && !!model && (!!provider.apiKey || provider.kind === 'ollama')
  return { provider, model, live: liveOk, label: model?.name || 'модель не выбрана' }
}

/* ------------------------------------------------------------------ файлы проекта */

/* ------------------------------------------------------------------ применить / отклонить / откатить */

type FilePart = Extract<Part, { k: 'file' }>
function turnMsg(chatId: ID, msgId: ID, pid: ID) {
  const m = getChat(pid, chatId)?.messages.find((x) => x.id === msgId)
  return m && m.kind === 'agent' ? m : undefined
}
function refreshTurn(pid: ID, chatId: ID, msgId: ID, version?: number) {
  const m = turnMsg(chatId, msgId, pid)
  if (!m?.parts) return
  const files = m.parts.filter((p): p is FilePart => p.k === 'file')
  const live_ = files.filter((f) => f.state !== 'error')
  const proposed = live_.filter((f) => f.state === 'proposed'),
    done = live_.filter((f) => f.state === 'done'),
    rev = live_.filter((f) => f.state === 'reverted')
  const state: TurnChanges['state'] = proposed.length
    ? done.length
      ? 'partial'
      : 'proposed'
    : done.length
      ? 'applied'
      : rev.length
        ? 'reverted'
        : 'rejected'
  S().patchMsg(
    chatId,
    msgId,
    {
      turn: {
        state,
        version: version ?? m.turn?.version,
        ...tally(files.filter((f) => f.state === 'done' || f.state === 'proposed')),
      },
    } as Partial<Message>,
    pid,
  )
}

/** Применить предложенные правки (все или одну карточку) */
export function applyProposed(
  chatId: ID,
  msgId: ID,
  partId?: ID,
  pickedText?: string,
  force = false,
  approval?: { pid: ID; snapshots: Record<ID, FileImage> },
) {
  const pid = S().projectId!
  const m = turnMsg(chatId, msgId, pid)
  if (!m?.parts) return
  const targets = m.parts.filter(
    (p): p is FilePart => p.k === 'file' && p.state === 'proposed' && (!partId || p.id === partId),
  )
  if (!targets.length) return
  const snapshots = Object.fromEntries(
    targets.map((t) => [t.id, currentImage(pid, t, (t as GuardedFile).agentGuard?.before)]),
  )
  const stale = targets.filter((t) => {
    const expected = (t as GuardedFile).agentGuard?.before
    return !expected || !sameImage(expected, snapshots[t.id])
  })
  if (
    stale.length &&
    (!force ||
      !approval ||
      approval.pid !== pid ||
      targets.some((t) => !approval.snapshots[t.id] || !sameImage(approval.snapshots[t.id], snapshots[t.id])))
  ) {
    S().openModal({
      type: 'confirm',
      title: 'Файлы изменились после предложения',
      body: `${stale.map((t) => t.path).join(', ')} — новые данные будут сохранены в .tetra/recovery перед применением.`,
      danger: true,
      confirm: 'Сохранить копию и применить',
      run: () => {
        if (S().projectId !== pid) return
        applyProposed(chatId, msgId, partId, pickedText, true, { pid, snapshots })
      },
    })
    return
  }
  if (stale.length) recover(pid, Object.assign({}, ...stale.map((t) => snapshots[t.id])))
  const applied: FilePart[] = []
  const parts = m.parts.map((p) => ({ ...p }))
  for (const t of targets) {
    const mine = parts.find((x) => x.id === t.id) as FilePart
    if (t.op === 'delete') {
      // Use the confirmed member set; never sweep in the just-created recovery copy.
      for (const f of Object.keys(snapshots[t.id])) putFile(pid, f, null)
    } else if (t.op === 'rename' && t.to) {
      const src = fileOf(pid, t.path)
      if (src === undefined) {
        mine.state = 'error'
        mine.error = 'Файла уже нет'
        continue
      }
      putFile(pid, t.to, src)
      putFile(pid, t.path, null)
    } else if (t.after != null) {
      if (pickedText != null && partId && t.op === 'edit') {
        /* принята только часть правок: в карточку и в версию попадает именно то, что записано */
        const st = diffStat(t.before ?? '', pickedText)
        mine.after = pickedText
        mine.add = st.add
        mine.del = st.del
        mine.lines = countLines(pickedText)
        putFile(pid, t.path, pickedText)
      } else putFile(pid, t.path, t.after)
    } else {
      mine.state = 'error'
      mine.error = 'Содержимое слишком большое, чтобы сохранить в чате — попроси агента повторить'
      continue
    }
    ;(mine as GuardedFile).agentGuard = {
      before: snapshots[t.id],
      after: currentImage(pid, mine, snapshots[t.id]),
    }
    mine.state = 'done'
    applied.push(mine)
  }
  S().patchMsg(chatId, msgId, { parts } as Partial<Message>, pid)
  const n = applied.length ? commitFiles(pid, chatId, m.agent, applied, '', 'Применено: ') : undefined
  refreshTurn(pid, chatId, msgId, n)
}
export function rejectProposed(chatId: ID, msgId: ID, partId?: ID) {
  const pid = S().projectId!
  const m = turnMsg(chatId, msgId, pid)
  if (!m?.parts) return
  const parts = m.parts.map((p) =>
    p.k === 'file' && p.state === 'proposed' && (!partId || p.id === partId)
      ? { ...p, state: 'rejected' as const }
      : p,
  )
  S().patchMsg(chatId, msgId, { parts } as Partial<Message>, pid)
  refreshTurn(pid, chatId, msgId)
}
/** Вернуть файлы к состоянию «до» этого хода агента */
export function revertTurn(
  chatId: ID,
  msgId: ID,
  force = false,
  approval?: { pid: ID; snapshot: FileImage },
) {
  const pid = S().projectId!
  const m = turnMsg(chatId, msgId, pid)
  if (!m?.parts) return
  const files = m.parts.filter((p): p is FilePart => p.k === 'file' && p.state === 'done')
  if (!files.length) return
  const p = S().projects.find((x) => x.id === pid)!
  const prev = p.versions.find((v) => v.n === (m.turn?.version ?? 0) - 1)?.snapshot
  const allPaths = [
    ...new Set(
      files.flatMap((f) => [
        ...pathsOf(pid, f),
        ...Object.keys((f as GuardedFile).agentGuard?.before || {}),
        ...Object.keys((f as GuardedFile).agentGuard?.after || {}),
      ]),
    ),
  ]
  const snapshot = image(pid, allPaths)
  const expected: FileImage = {}
  let unknown = false
  for (const f of files) {
    const guard = (f as GuardedFile).agentGuard
    if (!guard) unknown = true
    else Object.assign(expected, guard.after)
  }
  const changed = unknown || !sameImage(expected, snapshot)
  if (changed && (!force || !approval || approval.pid !== pid || !sameImage(approval.snapshot, snapshot))) {
    S().openModal({
      type: 'confirm',
      title: 'Откатить правки агента?',
      body: 'Файлы изменились или старая карточка не содержит точного состояния. Текущие данные будут сохранены в .tetra/recovery перед откатом.',
      danger: true,
      confirm: 'Сохранить копию и откатить',
      run: () => {
        if (S().projectId !== pid) return
        revertTurn(chatId, msgId, true, { pid, snapshot })
      },
    })
    return
  }
  if (changed) recover(pid, snapshot)
  const reverted: FilePart[] = []
  for (const f of [...files].reverse()) {
    const guard = (f as GuardedFile).agentGuard
    if (guard) {
      for (const [path, value] of Object.entries(guard.before)) putFile(pid, path, value)
    } else {
      const orig = f.before ?? (f.op === 'create' ? null : (prev?.[f.path] ?? null))
      // Legacy cards are only restored after explicit confirmation plus recovery.
      if (f.op === 'edit' && orig === null) {
        toast({
          title: 'Исходный файл не сохранён',
          desc: f.path + ' — попроси агента повторить правку',
          icon: 'warn',
        })
        continue
      }
      if (f.op === 'rename' && f.to) {
        if (orig === null) continue
        putFile(pid, f.path, orig)
        putFile(pid, f.to, prev?.[f.to] ?? null)
      } else if (f.op === 'delete' && orig === null) {
        const entries = Object.entries(prev || {}).filter(([path]) =>
          path.startsWith(f.path.replace(/\/+$/, '') + '/'),
        )
        if (!entries.length) continue
        for (const [path, content] of entries) putFile(pid, path, content)
      } else putFile(pid, f.path, orig)
    }
    reverted.push(f)
  }
  if (!reverted.length) return
  S().patchMsg(
    chatId,
    msgId,
    {
      parts: m.parts.map((x) =>
        x.k === 'file' && reverted.some((r) => r.id === x.id) ? { ...x, state: 'reverted' as const } : x,
      ),
    } as Partial<Message>,
    pid,
  )
  const n = S().commit(
    {
      title: 'Отмена: ' + (m.turn?.version ? `правки v${m.turn.version}` : 'правки агента'),
      by: 'human',
      author: S().people.me.name,
      tag: 'build',
      feats: [],
      changes: reverted.map((f) => 'Возвращён ' + f.path),
      fixes: [],
      details: ['Откат хода агента ' + m.agent],
    },
    pid,
  )
  refreshTurn(pid, chatId, msgId, m.turn?.version)
  toast({ title: 'Правки отменены', desc: `Новая версия v${n}`, icon: 'check', tone: 'ok' })
}

/* ------------------------------------------------------------------ отправка */

export function sendMessage(
  chatId: ID,
  text: string,
  attachments: Attachment[] = [],
  extra = '',
  depth = 0,
  opts: {
    silent?: string
    loop?: boolean
    imgs?: string[]
    pid?: ID
    agent?: string
    tier?: Tier
    prompt?: string
  } = {},
): boolean {
  const st = S()
  const pid = opts.pid || st.projectId
  if (!pid || !getChat(pid, chatId)) return false
  const t = text.trim()
  /* silent — проход цикла /loop: в чате вместо «сообщения человека» короткая служебная строка */
  if (!t && !attachments.length && !opts.silent) return false
  if (!resolveModel().live) {
    toast({
      title: 'Модель не подключена',
      desc: 'Добавь провайдера и ключ в Настройках — без него агент не отвечает',
      icon: 'key',
      tone: 'warn',
      action: { label: 'Открыть', run: () => S().openModal({ type: 'settings', section: 'providers' }) },
    })
    return false
  }
  st.pushMsg(
    chatId,
    opts.silent
      ? { id: uid('m'), kind: 'sys', text: opts.silent, at: Date.now() }
      : {
          id: uid('m'),
          kind: 'human',
          author: 'me',
          text: t,
          attachments: attachments.length ? attachments : undefined,
          at: Date.now(),
        },
    pid,
  )
  if (st.projectId === pid) st.setDraft(chatId, '')
  const chat = getChat(pid, chatId)
  const agent = chat?.agents[0]
  if (!agent) {
    st.pushMsg(
      chatId,
      {
        id: uid('m'),
        kind: 'sys',
        text: 'В чате нет агентов — добавь агента в полосе над перепиской, и он ответит',
        at: Date.now(),
      },
      pid,
    )
    return false
  }
  const lim = st.settings.budget
  if (lim && lim > 0 && resolveModel().live && monthSpent() >= lim) {
    st.pushMsg(
      chatId,
      {
        id: uid('m'),
        kind: 'sys',
        text: `Лимит расходов на месяц исчерпан (${fmtUsd(monthSpent())} из ${fmtUsd(lim)}). Подними его в Настройки → Расходы или выбери локальную модель — тогда нажми «Повторить»`,
        at: Date.now(),
      },
      pid,
    )
    toast({
      title: 'Лимит расходов исчерпан',
      desc: 'Запрос не отправлен модели',
      icon: 'warn',
      tone: 'warn',
    })
    return false
  }
  const mention = t.match(/@([\w-]+)/)?.[1]
  const who = opts.agent
    ? chat!.agents.find((a) => a.name === opts.agent)
    : chat!.agents.find((a) => a.name === mention) || agent
  if (!who) return false
  void runTurn(
    pid,
    chatId,
    opts.prompt ??
      (opts.silent ? extra : t || `Посмотри вложения: ${attachments.map((a) => a.name).join(', ')}`),
    who.name,
    opts.tier ?? who.tier,
    attachments,
    { ctx: opts.silent ? '' : extra, depth, loop: opts.loop, imgs: opts.imgs },
  )
  return true
}

async function runTurn(
  pid: ID,
  chatId: ID,
  prompt: string,
  agent: string,
  tier: Tier,
  attachments: Attachment[],
  opts: { skipAsk?: boolean; ctx?: string; depth?: number; loop?: boolean; imgs?: string[] } = {},
) {
  cancelQueuedTimer(chatId)
  controllers.get(chatId)?.abort()
  const ctl = new AbortController()
  controllers.set(chatId, ctl)
  const st = S()
  const chat = getChat(pid, chatId)!
  const { provider, model, label } = resolveModel()
  const msgId = uid('m'),
    laneId = uid('l')
  const t0 = Date.now()
  st.setChat(chatId, { running: true }, pid)
  st.pushMsg(
    chatId,
    {
      id: msgId,
      kind: 'agent',
      agent,
      tier,
      text: '',
      at: t0,
      startedAt: t0,
      streaming: true,
      thinking: 'Читаю контекст',
      model: label,
      parts: [],
    } as Message,
    pid,
  )
  st.setLanes(
    (l) => [
      ...l.filter((x) => x.chatId !== chatId),
      {
        id: laneId,
        who: agent,
        chatId,
        chat: chat.title,
        lease: '—',
        mode: 'read',
        act: 'читает контекст',
        pct: 8,
        subs: [],
      },
    ],
    pid,
  )
  const current = () => controllers.get(chatId) === ctl
  const T = new Turn(pid, chatId, msgId, agent, tier, laneId, ctl, current)
  let summary = ''
  let failed = false
  try {
    summary = await liveLoop(T, prompt, attachments, provider!, model!.id, label, opts.ctx, opts.imgs)
    if (backendOnline() && tier !== 'Эскалация' && S().settings.autoVerify !== false && !T.aborted)
      await verifyAfter(T, chatId, pid, opts.depth || 0)
    T.patch({ streaming: false, thinking: undefined, endedAt: Date.now() })
    T.guard()
    const ch = T.finish(summary)
    if (!T.aborted && !(ch && (ch.state === 'proposed' || ch.state === 'partial')))
      osNotify(
        `${agent} закончил`,
        (summary || 'Задача выполнена').replace(/[*`#]/g, '').slice(0, 140),
        () => {
          S().openProject(pid)
          S().setCenter({ kind: 'chat', id: chatId })
        },
      )
    if (tier === 'Уведомить' && ch?.version)
      toast({ title: `${agent} уведомляет`, desc: `v${ch.version} · ${ch.files} файл.`, icon: 'bell' })
    if (ch && (ch.state === 'proposed' || ch.state === 'partial'))
      notifyEscalation(pid, chatId, agent, `${ch.files} правок ждут решения`)
  } catch (e) {
    const aborted = ctl.signal.aborted
    T.stop()
    if (current()) live.endChat(chatId)
    T.flush(true)
    if (aborted) {
      T.finish('')
      T.patch({
        streaming: false,
        thinking: undefined,
        endedAt: Date.now(),
        stopped: true,
      } as Partial<Message>)
    } else {
      failed = true
      const err = `Не удалось получить ответ от **${label}**: ${(e as Error).message}\n\nПроверь ключ и Base URL в Настройках → Провайдеры.${backendOnline() ? '' : ' Если провайдер не разрешает запросы из браузера (CORS), запусти локальный бэкенд (`npm run server`) — запросы пойдут через него.'}`
      T.upsert({ k: 'text', id: 'err', text: err })
      T.finish('')
      T.patch({ streaming: false, thinking: undefined, error: true, endedAt: Date.now() })
      osNotify(`${agent}: ошибка`, (e as Error).message.slice(0, 140), () => {
        S().openProject(pid)
        S().setCenter({ kind: 'chat', id: chatId })
      })
    }
  } finally {
    T.stop()
    const owner = current()
    if (owner) {
      controllers.delete(chatId)
      S().setChat(chatId, { running: false }, pid)
    }
    S().setLanes((l) => l.filter((x) => x.id !== laneId), pid)
    // Keep the item in the queue until the callback actually accepts it.
    if (owner && !ctl.signal.aborted && peekQueue(chatId) && getChat(pid, chatId) && S().projectId === pid) {
      const generation = queueGeneration(chatId)
      const timer = setTimeout(() => {
        if (queueTimers.get(chatId) !== timer) return
        queueTimers.delete(chatId)
        if (
          generation !== queueGeneration(chatId) ||
          ctl.signal.aborted ||
          controllers.has(chatId) ||
          S().projectId !== pid ||
          !getChat(pid, chatId)
        )
          return
        const nx = peekQueue(chatId)
        if (!nx) return
        const sent = sendMessage(chatId, nx.text, nx.atts, nx.extra || '', autoFix.has(chatId) ? 1 : 0, {
          pid,
        })
        if (sent) {
          dequeue(chatId, nx.id)
          autoFix.delete(chatId)
        }
      }, 350)
      queueTimers.set(chatId, timer)
    }
    /* проход /loop закончился: цикл решает, идти ли дальше (во время паузы между проходами ход могут занять очередь и человек) */
    if (owner && opts.loop) {
      if (ctl.signal.aborted) loopStop(chatId, 'ход прерван')
      else loopPassEnded(chatId, T.parts.map((p) => (p.k === 'text' ? p.text : '')).join('\n'), failed)
    }
  }
}

/* ------------------------------------------------------------------ живая модель */

const MAX_STEPS = 6

/** Потрачено за месяц (+ оценка текущего хода). Для локальных моделей без цены — 0. */
export function monthSpent(extra?: Usage) {
  const st = S()
  const custom = st.settings.priceCustom || {}
  const base = report(st.projects, custom).month.cost
  return base + (extra ? (costOf(extra, custom) ?? 0) : 0)
}
const notified = new Set<string>()
/** Предупреждение на 80% и 100% лимита — по одному разу за месяц */
function budgetWarn() {
  const b = S().settings.budget
  if (!b || b <= 0) return
  const spent = monthSpent()
  const k = new Date().toISOString().slice(0, 7)
  for (const lvl of [1, 0.8])
    if (spent >= b * lvl && !notified.has(k + lvl) && localStorage.getItem('tf.bw.' + k + lvl) !== '1') {
      notified.add(k + lvl)
      try {
        localStorage.setItem('tf.bw.' + k + lvl, '1')
      } catch {
        /* ignore */
      }
      toast({
        title: lvl === 1 ? 'Лимит расходов исчерпан' : 'Израсходовано 80% лимита',
        desc: `${fmtUsd(spent)} из ${fmtUsd(b)} за месяц`,
        icon: 'warn',
        tone: 'warn',
      })
      break
    }
}

async function liveLoop(
  T: Turn,
  prompt: string,
  attachments: Attachment[],
  provider: NonNullable<ReturnType<typeof resolveModel>['provider']>,
  modelId: string,
  label: string,
  ctx = '',
  imgs: string[] = [],
): Promise<string> {
  const acct = { inChars: 0, steps: 0 }
  try {
    return await liveLoopInner(T, prompt, attachments, provider, modelId, label, ctx, acct, imgs)
  } finally {
    if (acct.steps)
      T.patch({
        usage: {
          inTok: Math.round(acct.inChars / 3.2),
          outTok: Math.round(T.chars / 3.2),
          steps: acct.steps,
          mid: modelId,
          free: provider.kind === 'ollama',
        },
      } as Partial<Message>)
    if (!T.aborted) budgetWarn()
  }
}

async function liveLoopInner(
  T: Turn,
  prompt: string,
  attachments: Attachment[],
  provider: NonNullable<ReturnType<typeof resolveModel>['provider']>,
  modelId: string,
  label: string,
  ctx: string,
  acct: { inChars: number; steps: number },
  imgs: string[] = [],
): Promise<string> {
  const { pid, chatId, agent, msgId } = T
  const project = () => S().projects.find((p) => p.id === pid)!
  const messages: ChatMsg[] = history(getChat(pid, chatId)!.messages, msgId)
  // The explicit current prompt is authoritative (including silent automation/loop turns).
  if (!messages.length || messages[messages.length - 1].role !== 'user')
    messages.push({ role: 'user', content: prompt })
  else messages[messages.length - 1] = { ...messages[messages.length - 1], content: prompt }
  T.guard()
  if (wantsGit(prompt)) ctx += await gitContext(project())
  T.guard()
  if (ctx)
    messages[messages.length - 1] = {
      ...messages[messages.length - 1],
      content: messages[messages.length - 1].content + '\n\n' + ctx,
    }
  /* картинки: вложения пользователя и то, что приложил цикл (скриншоты, эталон) — модель с «зрением» их увидит */
  const pics = [
    ...attachments.filter((a) => a.url && a.mime.startsWith('image/')).map((a) => a.url as string),
    ...imgs,
  ].slice(0, 6)
  if (pics.length) {
    messages[messages.length - 1] = { ...messages[messages.length - 1], images: pics }
    acct.inChars += pics.length * 3000
  }
  /* инструменты MCP: один раз на ход (серверы живут между ходами) */
  T.patch({ thinking: 'Подключаю инструменты' })
  const mcpAv: McpAvail = await loadMcp(project()).catch(() => ({ tools: {}, notes: {} }))
  T.guard()
  const mcpText = mcpSection(mcpAv)
  let first = ''
  for (let step = 0; step < MAX_STEPS; step++) {
    T.guard()
    const lim = S().settings.budget
    if (
      step > 0 &&
      lim &&
      lim > 0 &&
      monthSpent({
        inTok: Math.round(acct.inChars / 3.2),
        outTok: Math.round(T.chars / 3.2),
        steps: acct.steps,
        mid: modelId,
        free: provider.kind === 'ollama',
      }) >= lim
    ) {
      toast({
        title: 'Агент остановлен по лимиту расходов',
        desc: `Лимит ${fmtUsd(lim)} в месяц. Поменять — Настройки → Расходы`,
        icon: 'warn',
        tone: 'warn',
      })
      T.upsert({
        k: 'text',
        id: 'budget',
        text: `\n\n_Остановлено: достигнут месячный лимит расходов ${fmtUsd(lim)}._`,
      })
      break
    }
    T.patch({ thinking: step ? 'Анализирую результат' : 'Думаю' })
    T.lane({ act: step ? 'продолжает работу' : 'ждёт модель', pct: Math.min(90, 14 + step * 14) })
    let acc = ''
    acct.steps++
    const sysPrompt = systemPrompt(project(), agent, attachments, mcpText)
    acct.inChars += sysPrompt.length + messages.reduce((a, m) => a + m.content.length, 0)
    const opIds = new Map<number, ID>()
    const applied = new Set<number>()
    const pump = (final: boolean) => syncSegs(T, step, parseStream(acc, !final), final, opIds, applied)
    const iv = setInterval(() => pump(false), 50)
    try {
      await streamChat({
        provider,
        model: modelId,
        system: sysPrompt,
        messages,
        signal: T.ctl.signal,
        onOpen: () => {
          if (!T.aborted) T.patch({ thinking: 'Модель отвечает' })
        },
        onReasoning: (r) => {
          if (T.aborted) return
          T.reasoning += r
          T.chars += r.length
          T.touch()
          if (!T.firstAt) T.patch({ thinking: 'Рассуждает' })
        },
        onDelta: (d) => {
          if (T.aborted) return
          acc += d
          T.chars += d.length
          T.touch()
        },
      })
    } finally {
      clearInterval(iv)
    }
    T.guard()
    pump(true)
    if (!acc.trim() && !T.parts.length)
      T.upsert({ k: 'text', id: 'empty', text: '_Модель вернула пустой ответ._' })
    const segs = parseStream(acc, false)
    if (!first) first = segs.find((s) => s.t === 'text')?.s || ''
    const feedback: string[] = []
    const fbImgs: string[] = []
    /* ошибки применения правок — отдаём модели */
    segs.forEach((s, i) => {
      if (s.t !== 'op') return
      const id = opIds.get(i)
      const part = id ? T.parts.find((p) => p.id === id) : undefined
      if (part && part.k === 'file' && part.state === 'error' && part.error)
        feedback.push(`Ошибка в ${part.op === 'edit' ? 'edit' : part.op} ${part.path}: ${part.error}`)
    })
    /* команды и чтение */
    const actions = segs
      .map((s, i) => ({ s, i }))
      .filter(
        (x): x is { s: Extract<Seg, { t: 'op' }>; i: number } =>
          x.s.t === 'op' &&
          x.s.closed &&
          ['run', 'read', 'fetch', 'search', 'shot', 'mcp'].includes(x.s.kind),
      )
    for (const { s, i } of actions) {
      T.guard()
      const id = opIds.get(i) || `${step}-o${i}`
      if (s.kind === 'read') {
        const path = (s.attrs.path || '').trim()
        const body = fileOf(pid, path)
        T.upsert({ k: 'read', id, path, ok: body !== undefined })
        feedback.push(
          body === undefined
            ? `read ${path}: файла нет`
            : `Содержимое ${path}:\n${body.length > 60000 ? body.slice(0, 60000) + '\n…(обрезано)' : body}`,
        )
      } else if (s.kind === 'mcp') {
        const server = (s.attrs.server || '').trim(),
          tool = (s.attrs.tool || '').trim()
        T.lane({ act: `вызывает ${server}.${tool}`.slice(0, 40), mode: 'write' })
        const r = await mcpAction(project(), T.tier, mcpAv, server, tool, s.body)
        T.guard()
        T.upsert({ k: 'read', id, path: `${server}.${tool}`, ok: r.ok, label: 'mcp' })
        feedback.push(r.text)
        if (r.images?.length) fbImgs.push(...r.images)
      } else if (s.kind === 'fetch' || s.kind === 'search' || s.kind === 'shot') {
        T.lane({ act: s.kind === 'shot' ? 'смотрит страницу' : 'ищет в интернете', mode: 'read' })
        const arg = (s.attrs.url || s.body).trim()
        const r =
          s.kind === 'fetch'
            ? await webFetchTool(arg)
            : s.kind === 'search'
              ? await webSearchTool(s.body.trim())
              : await takeShotTool(project(), s.attrs)
        T.guard()
        T.upsert({ k: 'read', id, path: r.label, ok: r.ok, label: 'web' })
        feedback.push(r.text)
        if (r.images) fbImgs.push(...r.images)
      } else {
        const cmd = s.body.trim()
        T.upsert({ k: 'cmd', id, cmd, state: 'running', out: '', real: backendOnline() })
        T.lane({ act: 'запускает ' + cmd.slice(0, 40), mode: 'write' })
        const out = await runCommand(T, id, cmd)
        T.guard()
        feedback.push(`$ ${cmd}\n${out.text.slice(-6000)}\n(код выхода ${out.code})`)
      }
    }
    T.guard()
    T.flush(true)
    if (!feedback.length) break
    messages.push({ role: 'assistant', content: summarizeForHistory(acc) || '…' })
    messages.push({
      role: 'user',
      content:
        'Результаты:\n\n' +
        feedback.join('\n\n---\n\n') +
        (step === MAX_STEPS - 2 ? '\n\nЭто последний шаг: заверши работу и коротко подведи итог.' : ''),
      ...(fbImgs.length ? { images: fbImgs } : {}),
    })
    if (T.aborted) break
  }
  void label
  return first
}

/** Проверка после правок: подбираем команду по проекту, запускаем по-настоящему; при падении один раз просим агента исправить */
function verifyCommand(files: Record<string, string>, changed: string[]): string | null {
  try {
    const pkg = JSON.parse(files['package.json'] || 'null')
    const sc = pkg?.scripts || {}
    for (const k of ['typecheck', 'lint', 'test'])
      if (sc[k] && !(k === 'test' && /no test specified/.test(sc[k]))) return `npm run ${k} --silent`
  } catch {
    /* package.json битый — проверим ниже */
  }
  // No shell quoting of user-controlled filenames. Standalone JS/Python checks
  // wait for a structured argv server endpoint; fixed package scripts still work.
  void changed
  return null
}
async function verifyAfter(T: Turn, chatId: ID, pid: ID, depth: number) {
  T.guard()
  const changed = T.parts
    .filter(
      (p): p is Extract<Part, { k: 'file' }> => p.k === 'file' && p.state === 'done' && p.op !== 'delete',
    )
    .map((p) => p.to || p.path)
  if (!changed.length) return
  const proj = S().projects.find((p) => p.id === pid)
  if (!proj) return
  const cmd = verifyCommand(proj.files, changed)
  if (!cmd) return
  if (!T.parts.some((p) => p.k === 'file' && p.state === 'done')) return
  T.step('verify', 'Проверяю результат')
  T.flush(true)
  const id = 'verify'
  T.upsert({ k: 'cmd', id, cmd, state: 'running', out: '', real: true })
  T.lane({ act: 'проверяет: ' + cmd.slice(0, 36), mode: 'read' })
  const r = await runCommand(T, id, cmd)
  T.guard()
  T.closeSteps()
  if (r.code !== 0 && depth < 1) {
    const tail = r.text
      .replace(/\x1b\[[0-9;]*m/g, '')
      .trim()
      .split('\n')
      .slice(-30)
      .join('\n')
    enqueue(
      chatId,
      `Автопроверка \`${cmd}\` упала (код ${r.code}). Исправь ошибки, не ломая остальное:\n\n${tail}`,
      [],
    )
    S().toast({
      title: 'Проверка не прошла',
      desc: 'Агент попробует исправить сам (один раз)',
      icon: 'warn',
      tone: 'warn',
    })
    autoFix.add(chatId)
  }
}
const autoFix = new Set<ID>()

async function runCommand(
  T: Turn,
  id: ID,
  cmd: string,
  force = false,
): Promise<{ text: string; code: number }> {
  T.guard()
  const upd = (patch: Partial<Extract<Part, { k: 'cmd' }>>) => {
    if (T.aborted) return
    const p = T.parts.find((x) => x.id === id)
    if (p && p.k === 'cmd') {
      Object.assign(p, patch)
      T.touch()
    }
  }
  if (T.tier === 'Эскалация') {
    upd({ state: 'error', out: 'Команда не запущена: на уровне «Эскалация» запуск требует подтверждения.' })
    return { text: 'Пользователь не разрешил запуск команд на уровне «Эскалация».', code: 126 }
  }
  if (T.tier === 'Спросить' && !force) {
    const why = dangerOf(cmd)
    if (why) {
      upd({
        state: 'error',
        code: 126,
        out: `Нужно твоё «да»: ${why}.\nНажми «Повторить» на этой карточке, чтобы запустить команду.`,
      })
      return {
        text: `Команда не запущена: на уровне «Спросить» нужно разрешение пользователя (${why}). Объясни пользователю, зачем она нужна, — он запустит её кнопкой «Повторить» на карточке.`,
        code: 126,
      }
    }
  }
  const proj = S().projects.find((p) => p.id === T.pid)!
  let out = ''
  if (backendOnline()) {
    try {
      const r = await bExec(proj, cmd, {
        signal: T.ctl.signal,
        timeout: 300,
        onOut: (d) => {
          if (T.aborted) return
          out += d
          upd({ out: out.slice(-20000) })
        },
      })
      T.guard()
      upd({ state: r.code === 0 ? 'done' : 'error', code: r.code, out: out.slice(-20000) })
      return { text: out, code: r.code }
    } catch (e) {
      if (T.aborted) throw e
      upd({ state: 'error', out: String(e) })
      return { text: String(e), code: 1 }
    }
  }
  out =
    'Команда не запущена: сервер TetraFree не подключён (в десктопной сборке он стартует сам, в браузере — npm run server).'
  upd({ state: 'error', code: 127, out })
  return { text: out, code: 127 }
}

/* ---- повтор отдельной команды из карточки хода ---- */
const retryCtl = new Map<ID, AbortController>()
export const stopRetry = (partId: ID) => retryCtl.get(partId)?.abort()

/** Перезапуск одной команды агента (кнопка «Повторить» на карточке). Результат пишется в ту же карточку. */
export async function retryCommand(chatId: ID, msgId: ID, partId: ID) {
  const pid = S().projectId
  if (!pid || retryCtl.has(partId)) return
  if (isRunning(chatId)) {
    toast({ title: 'Агент ещё работает', desc: 'Дождись конца хода или нажми «Стоп».', icon: 'warn' })
    return
  }
  const patch = (x: Partial<Extract<Part, { k: 'cmd' }>>) => {
    const m = getChat(pid, chatId)?.messages.find((q) => q.id === msgId)
    if (!m || m.kind !== 'agent' || !m.parts) return
    S().patchMsg(
      chatId,
      msgId,
      { parts: m.parts.map((q) => (q.id === partId && q.k === 'cmd' ? { ...q, ...x } : q)) },
      pid,
    )
  }
  const m0 = getChat(pid, chatId)?.messages.find((q) => q.id === msgId)
  const part = m0 && m0.kind === 'agent' ? m0.parts?.find((q) => q.id === partId) : undefined
  if (!part || part.k !== 'cmd') return
  const ctl = new AbortController()
  retryCtl.set(partId, ctl)
  patch({ state: 'running', out: '', code: undefined })
  const proj = S().projects.find((q) => q.id === pid)!
  let out = ''
  try {
    if (backendOnline()) {
      const r = await bExec(proj, part.cmd, {
        signal: ctl.signal,
        timeout: 300,
        onOut: (d) => {
          if (ctl.signal.aborted) return
          out += d
          patch({ out: out.slice(-20000) })
        },
      })
      if (ctl.signal.aborted) throw new DOMException('Выполнение отменено', 'AbortError')
      patch({ state: r.code === 0 ? 'done' : 'error', code: r.code, out: out.slice(-20000), real: true })
    } else {
      patch({ state: 'error', code: 127, out: 'Сервер TetraFree не подключён — команду выполнить нельзя.' })
    }
  } catch (e) {
    patch({
      state: 'error',
      out: (out + (ctl.signal.aborted ? '\n^C остановлено' : '\n' + String(e))).trim().slice(-20000),
    })
  } finally {
    retryCtl.delete(partId)
  }
}

/** Приводит состояние хода в соответствие с разобранным потоком */
function syncSegs(
  T: Turn,
  step: number,
  segs: Seg[],
  final: boolean,
  ids: Map<number, ID>,
  applied: Set<number>,
) {
  if (T.aborted) return
  const { pid } = T
  segs.forEach((s, i) => {
    if (T.aborted) return
    const id = `${step}-${s.t === 'text' ? 't' : 'o'}${i}`
    ids.set(i, id)
    if (s.t === 'text') {
      T.text(id, s.s.replace(/^\s+/, ''))
      return
    }
    if (applied.has(i)) return
    const path = (s.attrs.path || '').trim()
    switch (s.kind) {
      case 'write': {
        if (!path) return
        const perr = agentPathError(path)
        if (perr) {
          if (!T.part(id)) T.begin(id, 'create', path)
          T.fail(id, 'create', path, perr)
          applied.add(i)
          return
        }
        if (!T.part(id)) T.begin(id, 'create', path)
        const body = cleanBody(s.body)
        if (s.closed) {
          T.endWrite(id, path, body)
          applied.add(i)
        } else if (final) T.fail(id, 'create', path, 'Ответ оборвался до конца файла — файл не записан')
        else T.progress(id, path, body)
        break
      }
      case 'edit': {
        if (!path) return
        const perr = agentPathError(path)
        if (perr) {
          T.fail(id, 'edit', path, perr)
          applied.add(i)
          return
        }
        const cur = T.beginEdit(id, path)
        if (cur == null) {
          if (s.closed || final) {
            T.fail(id, 'edit', path, 'Файла нет — используй <write>')
            applied.add(i)
          }
          return
        }
        const pairs = parsePairs(s.body)
        const pre = pairs.filter((p) => p.complete)
        const r = applyPairs(cur, s.closed ? pairs : pre)
        if (s.closed) {
          if (r.failed.length || !pairs.length) {
            T.fail(
              id,
              'edit',
              path,
              !pairs.length
                ? 'Пустая правка'
                : `Не нашёл фрагмент для замены (${r.failed.length} из ${pairs.length}) — файл не изменён`,
            )
            applied.add(i)
          } else {
            T.endWrite(id, path, r.out)
            applied.add(i)
          }
        } else if (final) T.fail(id, 'edit', path, 'Ответ оборвался — правка не применена')
        else T.progress(id, path, r.out)
        break
      }
      case 'delete': {
        if (!path) return
        const perr = agentPathError(path)
        if (perr) {
          T.fail(id, 'delete', path, perr)
          applied.add(i)
          return
        }
        const list = expandDelete(pid, path)
        if (!list.length) {
          T.fail(id, 'delete', path, 'Такого файла или папки нет')
          applied.add(i)
          return
        }
        list.forEach((f, k) => T.endDelete(`${id}.${k}`, f))
        applied.add(i)
        break
      }
      case 'rename': {
        const perr = agentPathError(s.attrs.from || '') || agentPathError(s.attrs.to || '')
        if (perr) {
          T.fail(id, 'rename', s.attrs.to || '', perr)
          applied.add(i)
          break
        }
        T.endRename(id, s.attrs.from || '', s.attrs.to || '')
        applied.add(i)
        break
      }
      case 'run':
        if (!T.part(id) && s.closed) T.upsert({ k: 'cmd', id, cmd: s.body.trim(), state: 'running', out: '' })
        else if (!T.part(id)) T.step(id, 'Готовит команду…')
        break
      case 'read':
      case 'fetch':
      case 'search':
      case 'shot':
      case 'mcp':
        break
    }
  })
}

function notifyEscalation(pid: ID, chatId: ID, agent: string, label: string) {
  const st = S()
  if (!st.settings.notifyEscalations) return
  osNotify(`${agent} ждёт решения`, label, () => {
    S().openProject(pid)
    S().setCenter({ kind: 'chat', id: chatId })
  })
  const viewing =
    st.projectId === pid && st.center.kind === 'chat' && st.center.id === chatId && st.screen === 'workspace'
  if (!viewing)
    toast({
      title: `${agent} ждёт разрешения`,
      desc: label,
      icon: 'shield',
      tone: 'warn',
      action: {
        label: 'Открыть',
        run: () => {
          S().openProject(pid)
          S().setCenter({ kind: 'chat', id: chatId })
        },
      },
    })
}

setLoopRunner({
  send: (chatId, o) =>
    sendMessage(chatId, o.text, [], o.extra, 0, { silent: o.silent, loop: true, imgs: o.imgs }),
  busy: (chatId) => isRunning(chatId) || (useQueue.getState().q[chatId] || []).length > 0,
  projectOpen: (pid) => S().projectId === pid,
  say: (chatId, pid, text) => S().pushMsg(chatId, { id: uid('m'), kind: 'sys', text, at: Date.now() }, pid),
})
