/* Движок агента. Один ход (Turn) = одно сообщение агента, внутри которого живые части:
   текст, шаги, карточки файлов (создаёт / правит / удаляет), команды. Всё применяется к проекту
   по мере того, как модель пишет, и в конце собирается в одну версию. */
import { shiftQueue, enqueue } from './queue'
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

const S = () => useStore.getState()
const controllers = new Map<ID, AbortController>()
export const isRunning = (chatId: ID) => controllers.has(chatId)
export function stopTurn(chatId: ID) {
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
export function applyProposed(chatId: ID, msgId: ID, partId?: ID, pickedText?: string, force = false) {
  const pid = S().projectId!
  const m = turnMsg(chatId, msgId, pid)
  if (!m?.parts) return
  const targets = m.parts.filter(
    (p): p is FilePart => p.k === 'file' && p.state === 'proposed' && (!partId || p.id === partId),
  )
  if (!targets.length) return
  /* файл поменяли после того, как агент его предложил: запись затрёт чужие правки — спросим, а не перезапишем молча */
  if (!force) {
    const stale = targets.filter((t) => {
      if (t.op !== 'edit' && t.op !== 'create') return false
      const cur = fileOf(pid, t.path)
      if (cur === undefined) return false
      /* у больших файлов «до» в карточке не хранится (before = null) — сверить нечего */
      return t.op === 'create' ? true : t.before != null && cur !== t.before
    })
    if (stale.length) {
      S().openModal({
        type: 'confirm',
        title: 'Файл изменился после предложения',
        body: `${stale.map((t) => t.path).join(', ')} — с тех пор файл поменяли. Применение перезапишет текущее содержимое версией агента.`,
        danger: true,
        confirm: 'Перезаписать',
        run: () => applyProposed(chatId, msgId, partId, pickedText, true),
      })
      return
    }
  }
  const applied: FilePart[] = []
  const parts = m.parts.map((p) => ({ ...p }))
  for (const t of targets) {
    const mine = parts.find((x) => x.id === t.id) as FilePart
    if (t.op === 'delete') {
      for (const f of expandDelete(pid, t.path)) putFile(pid, f, null)
      if (fileOf(pid, t.path) !== undefined) putFile(pid, t.path, null)
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
export function revertTurn(chatId: ID, msgId: ID, force = false) {
  const pid = S().projectId!
  const m = turnMsg(chatId, msgId, pid)
  if (!m?.parts) return
  const files = m.parts.filter((p): p is FilePart => p.k === 'file' && p.state === 'done')
  if (!files.length) return
  const p = S().projects.find((x) => x.id === pid)!
  const prev = p.versions.find((v) => v.n === (m.turn?.version ?? 0) - 1)?.snapshot
  const changed = files.filter(
    (f) => f.op !== 'delete' && f.op !== 'rename' && f.after != null && p.files[f.path] !== f.after,
  )
  if (changed.length && !force) {
    S().openModal({
      type: 'confirm',
      title: 'Откатить правки агента?',
      body: `С тех пор вы или другой агент меняли: ${changed.map((f) => f.path).join(', ')}. Откат перезапишет эти правки.`,
      danger: true,
      confirm: 'Откатить',
      run: () => revertTurn(chatId, msgId, true),
    })
    return
  }
  const reverted: FilePart[] = []
  for (const f of [...files].reverse()) {
    const orig =
      f.before !== undefined && f.before !== null
        ? f.before
        : f.op === 'create'
          ? null
          : (prev?.[f.path] ?? null)
    if (f.op === 'rename' && f.to) {
      const cur = p.files[f.to] ?? fileOf(pid, f.to)
      if (cur !== undefined) putFile(pid, f.path, cur)
      putFile(pid, f.to, null)
    } else if (f.op === 'delete') {
      if (orig === null) continue
      putFile(pid, f.path, orig)
    } else putFile(pid, f.path, orig)
    reverted.push(f)
  }
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

export function sendMessage(chatId: ID, text: string, attachments: Attachment[] = [], extra = '', depth = 0) {
  const st = S()
  const pid = st.projectId!
  const t = text.trim()
  if (!t && !attachments.length) return
  if (!resolveModel().live) {
    toast({
      title: 'Модель не подключена',
      desc: 'Добавь провайдера и ключ в Настройках — без него агент не отвечает',
      icon: 'key',
      tone: 'warn',
      action: { label: 'Открыть', run: () => S().openModal({ type: 'settings', section: 'providers' }) },
    })
    return
  }
  st.pushMsg(
    chatId,
    {
      id: uid('m'),
      kind: 'human',
      author: 'me',
      text: t,
      attachments: attachments.length ? attachments : undefined,
      at: Date.now(),
    },
    pid,
  )
  st.setDraft(chatId, '')
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
    return
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
    return
  }
  const mention = t.match(/@([\w-]+)/)?.[1]
  const who = chat!.agents.find((a) => a.name === mention) || agent
  void runTurn(
    pid,
    chatId,
    t || `Посмотри вложения: ${attachments.map((a) => a.name).join(', ')}`,
    who.name,
    who.tier,
    attachments,
    { ctx: extra, depth },
  )
}

async function runTurn(
  pid: ID,
  chatId: ID,
  prompt: string,
  agent: string,
  tier: Tier,
  attachments: Attachment[],
  opts: { skipAsk?: boolean; ctx?: string; depth?: number } = {},
) {
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
  const T = new Turn(pid, chatId, msgId, agent, tier, laneId, ctl)
  let summary = ''
  try {
    summary = await liveLoop(T, prompt, attachments, provider!, model!.id, label, opts.ctx)
    if (backendOnline() && tier !== 'Эскалация' && S().settings.autoVerify !== false && !T.aborted)
      await verifyAfter(T, chatId, pid, opts.depth || 0)
    T.patch({ streaming: false, thinking: undefined, endedAt: Date.now() })
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
    live.endChat(chatId)
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
    controllers.delete(chatId)
    S().setChat(chatId, { running: false }, pid)
    S().setLanes((l) => l.filter((x) => x.id !== laneId), pid)
    /* следующее сообщение из очереди — если ход не прервали вручную */
    if (!ctl.signal.aborted) {
      const nx = shiftQueue(chatId)
      if (nx && getChat(pid, chatId) && S().projectId === pid)
        setTimeout(() => sendMessage(chatId, nx.text, nx.atts, '', autoFix.delete(chatId) ? 1 : 0), 350)
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
): Promise<string> {
  const acct = { inChars: 0, steps: 0 }
  try {
    return await liveLoopInner(T, prompt, attachments, provider, modelId, label, ctx, acct)
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
    setTimeout(budgetWarn, 50)
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
): Promise<string> {
  const { pid, chatId, agent, msgId } = T
  const project = () => S().projects.find((p) => p.id === pid)!
  const messages: ChatMsg[] = history(getChat(pid, chatId)!.messages, msgId)
  if (!messages.length || messages[messages.length - 1].role !== 'user')
    messages.push({ role: 'user', content: prompt })
  if (wantsGit(prompt)) ctx += await gitContext(project())
  if (ctx)
    messages[messages.length - 1] = {
      ...messages[messages.length - 1],
      content: messages[messages.length - 1].content + '\n\n' + ctx,
    }
  let first = ''
  for (let step = 0; step < MAX_STEPS; step++) {
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
    const sysPrompt = systemPrompt(project(), agent, attachments)
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
        onOpen: () => T.patch({ thinking: 'Модель отвечает' }),
        onReasoning: (r) => {
          T.reasoning += r
          T.chars += r.length
          T.touch()
          if (!T.firstAt) T.patch({ thinking: 'Рассуждает' })
        },
        onDelta: (d) => {
          acc += d
          T.chars += d.length
          T.touch()
        },
      })
    } finally {
      clearInterval(iv)
    }
    pump(true)
    if (!acc.trim() && !T.parts.length)
      T.upsert({ k: 'text', id: 'empty', text: '_Модель вернула пустой ответ._' })
    const segs = parseStream(acc, false)
    if (!first) first = segs.find((s) => s.t === 'text')?.s || ''
    const feedback: string[] = []
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
          x.s.t === 'op' && x.s.closed && (x.s.kind === 'run' || x.s.kind === 'read'),
      )
    for (const { s, i } of actions) {
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
      } else {
        const cmd = s.body.trim()
        T.upsert({ k: 'cmd', id, cmd, state: 'running', out: '', real: backendOnline() })
        T.lane({ act: 'запускает ' + cmd.slice(0, 40), mode: 'write' })
        const out = await runCommand(T, id, cmd)
        feedback.push(`$ ${cmd}\n${out.text.slice(-6000)}\n(код выхода ${out.code})`)
      }
    }
    T.flush(true)
    if (!feedback.length) break
    messages.push({ role: 'assistant', content: summarizeForHistory(acc) || '…' })
    messages.push({
      role: 'user',
      content:
        'Результаты:\n\n' +
        feedback.join('\n\n---\n\n') +
        (step === MAX_STEPS - 2 ? '\n\nЭто последний шаг: заверши работу и коротко подведи итог.' : ''),
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
  const py = changed.filter((f) => f.endsWith('.py'))
  if (py.length) return 'python3 -m py_compile ' + py.map((f) => JSON.stringify(f)).join(' ')
  const js = changed.filter((f) => /\.(m?js|cjs)$/.test(f))
  if (js.length) return js.map((f) => 'node --check ' + JSON.stringify(f)).join(' && ')
  return null
}
async function verifyAfter(T: Turn, chatId: ID, pid: ID, depth: number) {
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

async function runCommand(T: Turn, id: ID, cmd: string): Promise<{ text: string; code: number }> {
  const upd = (patch: Partial<Extract<Part, { k: 'cmd' }>>) => {
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
  const proj = S().projects.find((p) => p.id === T.pid)!
  let out = ''
  if (backendOnline()) {
    try {
      const r = await bExec(proj, cmd, {
        signal: T.ctl.signal,
        timeout: 300,
        onOut: (d) => {
          out += d
          upd({ out: out.slice(-20000) })
        },
      })
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
          out += d
          patch({ out: out.slice(-20000) })
        },
      })
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
  const { pid } = T
  segs.forEach((s, i) => {
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
        const cur = T.before.has(path) && T.after.has(path) ? T.after.get(path) : fileOf(pid, path)
        if (cur == null) {
          if (s.closed || final) {
            T.fail(id, 'edit', path, 'Файла нет — используй <write>')
            applied.add(i)
          }
          return
        }
        if (!T.part(id)) T.begin(id, 'edit', path)
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
        const perr = agentPathError(s.attrs.to || '')
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
