/* Ход агента в чате: текст, шаги, карточки файлов (как в Cursor / VS Code), команды, итоговая плашка. */
import { CopyBtn } from '../components/ui/CopyBtn'
import { memo, useEffect, useMemo, useState } from 'react'
import { useStore, useProject } from '../store'
import type { Message, Part } from '../types'
import { AgentAvatar, Spin } from '../components/ui/primitives'
import { Icon } from '../components/ui/Icon'
import { Markdown } from '../components/ui/Markdown'
import {
  applyProposed,
  rejectProposed,
  retryCommand,
  revertTurn,
  sendMessage,
  stopRetry,
} from '../agent/engine'
import { useLiveFile } from '../agent/live'
import { compact, diffStat, type DiffLine } from '../lib/diff'
import { applyPicked, changeBlocks } from '../lib/hunkpick'
import { clock } from '../lib/util'
import { costOf, fmtUsd, type Usage } from '../lib/usage'

type A = Extract<Message, { kind: 'agent' }>
type FilePart = Extract<Part, { k: 'file' }>
type CmdPart = Extract<Part, { k: 'cmd' }>

const OPS: Record<string, [string, string, string]> = {
  create: ['Создаёт', 'Создан', 'Создать'],
  edit: ['Редактирует', 'Изменён', 'Изменить'],
  delete: ['Удаляет', 'Удалён', 'Удалить'],
  rename: ['Переименовывает', 'Переименован', 'Переименовать'],
}
const dir = (p: string) => {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i + 1)
}
const nm = (p: string) => p.slice(p.lastIndexOf('/') + 1)

export const AgentTurn = memo(function AgentTurn({ m, chatId }: { m: A; chatId: string }) {
  const parts = m.parts
  const legacy = !parts || (!parts.length && !m.streaming)
  const lastText = parts ? [...parts].reverse().find((p) => p.k === 'text')?.id : undefined
  const lastIsText = parts && parts.length > 0 && parts[parts.length - 1].k === 'text'
  return (
    <div className={'turn' + (m.error ? ' err' : '')}>
      <AgentAvatar name={m.agent} size={32} />
      <div className="body at-body">
        <div className="nm">
          <span className="who-n">{m.agent}</span>
          {m.tier && <span className="chip sm">{m.tier}</span>}
          {m.model && <span className="mtag">{m.model}</span>}
          <span>{clock(m.at)}</span>
          {m.text && !m.streaming && <CopyBtn text={m.text} />}
        </div>
        {m.reasoning && <Reasoning text={m.reasoning} live={!!m.streaming && !m.firstAt} />}
        {legacy ? (
          m.text ? (
            <div className={'bubble' + (m.streaming ? ' streaming' : '')}>
              <Markdown text={m.text} caret={m.streaming} />
            </div>
          ) : null
        ) : (
          parts!.map((p) => (
            <PartView
              key={p.id}
              p={p}
              chatId={chatId}
              msg={m}
              caret={!!m.streaming && p.id === lastText && !!lastIsText}
            />
          ))
        )}
        {m.streaming && <Pulse m={m} />}
        {!m.streaming && m.stopped && (
          <div className="at-stopped">
            <Icon name="stop" size={12} />
            Остановлено{m.endedAt && m.startedAt ? ` · ${secs(m.endedAt - m.startedAt)}` : ''}
          </div>
        )}
        {!m.streaming && (m.stopped || m.error) && <RetryBtn chatId={chatId} msgId={m.id} />}
        {m.turn && !m.streaming && <TurnBar m={m} chatId={chatId} />}
        {m.usage && !m.streaming && (
          <div className="at-usage" title="Оценка по длине текста: точные цифры показывает провайдер">
            <Icon name="bolt" size={11} />≈ {fmtTok(m.usage.inTok)} на входе · ≈ {fmtTok(m.usage.outTok)} на
            выходе{usd(m.usage)}
            {m.usage.steps > 1 ? ` · ${m.usage.steps} шага` : ''}
            {m.endedAt && m.startedAt ? ' · ' + secs(m.endedAt - m.startedAt) : ''}
          </div>
        )}
        {!m.streaming &&
          m.endedAt &&
          m.startedAt &&
          !m.turn &&
          !m.usage &&
          !m.stopped &&
          !m.error &&
          (m.chars || 0) > 40 && <div className="at-time">{secs(m.endedAt - m.startedAt)}</div>}
      </div>
    </div>
  )
})

/* «Повторить»: только у последней реплики чата — заново отправляет предыдущий запрос человека */
function RetryBtn({ chatId, msgId }: { chatId: string; msgId: string }) {
  const req = useStore((s) => {
    const c = s.projects.flatMap((p) => p.chats).find((x) => x.id === chatId)
    if (!c || c.running) return null
    const i = c.messages.findIndex((x) => x.id === msgId)
    if (i < 0 || i !== c.messages.length - 1) return null
    for (let j = i - 1; j >= 0; j--) {
      const x = c.messages[j]
      if (x.kind === 'human') return x.text
    }
    return null
  })
  if (!req) return null
  return (
    <button className="btn sm gho at-retry" onClick={() => sendMessage(chatId, req)}>
      <Icon name="refresh" size={12} />
      Повторить запрос
    </button>
  )
}

const usd = (u: Usage) => {
  const c = costOf(u, useStore.getState().settings.priceCustom || {})
  return c === null || u.free ? '' : ' · ≈ ' + fmtUsd(c)
}
const fmtTok = (n: number) =>
  (n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : String(n)) + ' ток.'
const secs = (ms: number) => (ms < 10000 ? (ms / 1000).toFixed(1) : Math.round(ms / 1000)) + ' с'

function useNow(on: boolean) {
  const [n, setN] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setN(Date.now()), 250)
    return () => clearInterval(t)
  }, [on])
  return n
}

/* Всегда видно, что агент жив: что делает, сколько времени, с какой скоростью */
function Pulse({ m }: { m: A }) {
  const now = useNow(true)
  const start = m.startedAt || m.at
  const el = now - start
  const last = m.parts?.[m.parts.length - 1]
  const writing = m.parts?.find((p) => p.k === 'file' && p.state === 'writing') as FilePart | undefined
  const running = m.parts?.find((p) => p.k === 'cmd' && p.state === 'running') as CmdPart | undefined
  let label = m.thinking || 'Работает'
  if (writing) label = `${OPS[writing.op][0]} ${nm(writing.path)}`
  else if (running) label = `Выполняет ${running.cmd.slice(0, 40)}`
  else if (last?.k === 'text' && !m.thinking) label = 'Пишет ответ'
  else if (last?.k === 'step' && !last.done) label = last.text
  const stuck = !m.firstAt && el > 12000
  const rate = m.chars && el > 1500 ? Math.round((m.chars / el) * 1000) : 0
  return (
    <div className={'at-pulse' + (stuck ? ' slow' : '')} role="status" aria-live="polite">
      <Spin size={13} />
      <span className="pl">{label}</span>
      <span className="pt">{secs(el)}</span>
      {rate > 0 && <span className="pt">{rate} симв/с</span>}
      {stuck && (
        <span className="ph">Модель отвечает долго — это нормально для больших задач. Можно остановить.</span>
      )}
    </div>
  )
}

function Reasoning({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={'at-reason' + (live ? ' live' : '')}>
      <button onClick={() => setOpen(!open)}>
        {live ? <Spin size={12} /> : <Icon name="sparkle" size={12} />}
        {live ? 'Рассуждает' : 'Ход мысли'}
        <Icon name={open ? 'chevd' : 'chev'} size={10} />
      </button>
      {(open || live) && (
        <div className={'rtxt' + (live && !open ? ' tail' : '')}>{open ? text : text.slice(-220)}</div>
      )}
    </div>
  )
}

function PartView({ p, chatId, msg, caret }: { p: Part; chatId: string; msg: A; caret: boolean }) {
  if (p.k === 'text')
    return p.text.trim() ? (
      <div className={'bubble' + (caret ? ' streaming' : '')}>
        <Markdown text={p.text} caret={caret} />
      </div>
    ) : null
  if (p.k === 'step')
    return (
      <div className={'at-step' + (p.done ? ' done' : '')}>
        {p.done ? <Icon name="check" size={12} /> : <Spin size={12} />}
        <span>{p.text}</span>
      </div>
    )
  if (p.k === 'read')
    return (
      <div className={'at-step' + (p.ok ? ' done' : ' bad')}>
        <Icon name={p.ok ? 'eye' : 'warn'} size={12} />
        <span>
          {p.label ? (p.ok ? 'Посмотрел ' : 'Не вышло: ') : p.ok ? 'Прочитал ' : 'Не нашёл '}
          <code>{p.path}</code>
        </span>
      </div>
    )
  if (p.k === 'cmd') return <CmdCard p={p} chatId={chatId} msgId={msg.id} />
  return <FileCard p={p} chatId={chatId} msg={msg} />
}

function CmdCard({ p, chatId, msgId }: { p: CmdPart; chatId: string; msgId: string }) {
  const [open, setOpen] = useState(p.state === 'running')
  useEffect(() => {
    if (p.state === 'running') setOpen(true)
  }, [p.state])
  return (
    <div className={'at-card cmd ' + p.state}>
      <button className="ch" onClick={() => setOpen(!open)}>
        {p.state === 'running' ? <Spin size={13} /> : <Icon name="terminal" size={14} />}
        <code className="cp">{p.cmd}</code>
        <span className="cs">
          {p.state === 'running'
            ? 'выполняется'
            : p.state === 'done'
              ? 'готово'
              : p.code
                ? `код ${p.code}`
                : 'не выполнена'}
        </span>
        <Icon name={open ? 'chevd' : 'chev'} size={10} />
      </button>
      {open && p.out && <pre className="cout">{p.out.slice(-4000)}</pre>}
      {open && (
        <div className="cmd-act">
          {p.state === 'running' ? (
            <button className="btn sm gho" onClick={() => stopRetry(p.id)}>
              <Icon name="stop" size={11} />
              Остановить
            </button>
          ) : (
            <button
              className="btn sm gho"
              onClick={() => void retryCommand(chatId, msgId, p.id)}
              title="Запустить эту команду ещё раз на этой машине"
            >
              <Icon name="refresh" size={11} />
              {p.state === 'error' && !p.code ? 'Запустить' : 'Повторить'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function FileCard({ p, chatId, msg }: { p: FilePart; chatId: string; msg: A }) {
  const pid = useProject()?.id
  const livef = useLiveFile(pid, p.state === 'writing' ? p.path : null)
  const [open, setOpen] = useState(false)
  const st = useStore.getState
  const label =
    p.state === 'writing'
      ? OPS[p.op][0]
      : p.state === 'proposed'
        ? OPS[p.op][2] + '?'
        : p.state === 'error'
          ? 'Не удалось'
          : p.state === 'rejected'
            ? 'Отклонено'
            : p.state === 'reverted'
              ? 'Отменено'
              : OPS[p.op][1]
  const lines = livef ? livef.text.split('\n').length : p.lines || 0
  const rows = useMemo(() => {
    if (!open || (p.op === 'delete' && !p.before)) return null
    if (p.state === 'writing') return null
    const a = p.op === 'delete' ? p.before : (p.before ?? ''),
      b = p.op === 'delete' ? '' : p.after
    if (b == null || a == null) return undefined
    return compact(diffStat(a, b).lines, 2).slice(0, 220)
  }, [open, p.state, p.before, p.after, p.op])
  /* предложенную правку файла можно принять частями, если в ней несколько отдельных блоков */
  const pick = useMemo(() => {
    if (!open || p.state !== 'proposed' || p.op !== 'edit' || p.before == null || p.after == null) return null
    const l = diffStat(p.before, p.after).lines
    return changeBlocks(l).length > 1 ? l : null
  }, [open, p.state, p.op, p.before, p.after])
  const clickable = p.state !== 'writing' || !!livef
  const openFile = () => {
    if (p.op !== 'delete' && p.state !== 'error')
      st().openFile(p.state === 'proposed' && p.op === 'rename' && p.to ? p.path : p.path)
  }
  const canOpen = p.op !== 'delete' && p.state !== 'error' && p.state !== 'reverted' && p.state !== 'rejected'
  return (
    <div className={`at-card file ${p.op} ${p.state}`}>
      <div className="ch">
        <button
          className="cexp"
          onClick={() => setOpen(!open)}
          aria-label="Показать изменения"
          aria-expanded={open}
        >
          <Icon name={open ? 'chevd' : 'chev'} size={10} />
        </button>
        <span className="ci">
          {p.state === 'writing' ? (
            <Spin size={13} />
          ) : (
            <Icon
              name={
                p.op === 'delete'
                  ? 'trash'
                  : p.op === 'create'
                    ? 'plus'
                    : p.op === 'rename'
                      ? 'arrowdown'
                      : 'pen'
              }
              size={13}
            />
          )}
        </span>
        <button
          className="cpath"
          disabled={!canOpen || !clickable}
          onClick={openFile}
          title={p.path + (p.to ? ' → ' + p.to : '')}
        >
          <span className="cd">{dir(p.path)}</span>
          <span className="cn">{nm(p.path)}</span>
          {p.to && <span className="cto"> → {p.to}</span>}
        </button>
        <span className="clab">{label}</span>
        <span className="cstat">
          {p.state === 'writing' ? (
            <span className="cl">{lines} стр.</span>
          ) : p.state === 'error' ? null : (
            <>
              {p.add > 0 && <span className="add">+{p.add}</span>}
              {p.del > 0 && <span className="del">−{p.del}</span>}
              {!p.add && !p.del && p.op !== 'rename' && <span className="cl">без изменений</span>}
            </>
          )}
        </span>
        {p.state === 'proposed' && (
          <span className="cact">
            <button className="btn sm pri" onClick={() => applyProposed(chatId, msg.id, p.id)}>
              {OPS[p.op][2]}
            </button>
            <button className="btn sm gho" onClick={() => rejectProposed(chatId, msg.id, p.id)}>
              Оставить
            </button>
          </span>
        )}
      </div>
      {p.error && (
        <div className="cerr">
          <Icon name="warn" size={12} />
          {p.error}
        </div>
      )}
      {p.state === 'writing' && p.op !== 'delete' && (
        <div className="cbar2">
          <i />
        </div>
      )}
      {open && (
        <div className="cdiff">
          {p.state === 'writing' && livef && (
            <div className="dl add">
              {livef.text
                .split('\n')
                .slice(-12)
                .map((l, i) => (
                  <div key={i}>
                    <span className="dg">+</span>
                    {l || ' '}
                  </div>
                ))}
            </div>
          )}
          {pick && (
            <PickChanges
              lines={pick}
              onApply={(text) => applyProposed(chatId, msg.id, p.id, text)}
              onReject={() => rejectProposed(chatId, msg.id, p.id)}
            />
          )}
          {rows === undefined && (
            <div className="dnote">
              Файл слишком большой, чтобы хранить дифф в чате — смотри историю версий.
            </div>
          )}
          {rows === null && p.state !== 'writing' && (
            <div className="dnote">
              {p.op === 'delete' ? 'Файл удалён. Содержимое сохранено в предыдущей версии.' : 'Нет данных'}
            </div>
          )}
          {rows && rows.length === 0 && <div className="dnote">Содержимое не изменилось</div>}
          {rows &&
            !pick &&
            rows.map((l, i) =>
              l.t === 'gap' ? (
                <div key={i} className="dl gap">
                  {l.s}
                </div>
              ) : (
                <div key={i} className={'dl ' + (l.t === '+' ? 'add' : l.t === '-' ? 'del' : '')}>
                  <span className="dg">{l.t === ' ' ? ' ' : l.t === '+' ? '+' : '−'}</span>
                  {l.s || ' '}
                </div>
              ),
            )}
        </div>
      )}
    </div>
  )
}

/** Выбор отдельных блоков правки: каждый можно принять или оставить как было */
function PickChanges({
  lines,
  onApply,
  onReject,
}: {
  lines: DiffLine[]
  onApply: (text: string) => void
  onReject: () => void
}) {
  const blocks = useMemo(() => changeBlocks(lines), [lines])
  const [on, setOn] = useState<Set<number>>(() => new Set(blocks.map((b) => b.id)))
  const flip = (id: number) =>
    setOn((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  return (
    <div className="pick">
      {blocks.map((b, k) => {
        const from = Math.max(0, b.from - 2),
          to = Math.min(lines.length, b.to + 2)
        return (
          <div key={b.id} className={'pick-b' + (on.has(b.id) ? '' : ' off')}>
            <label className="pick-h">
              <input type="checkbox" checked={on.has(b.id)} onChange={() => flip(b.id)} />
              <span>
                Правка {k + 1} из {blocks.length}
              </span>
              <span className="cstat">
                {b.add > 0 && <span className="add">+{b.add}</span>}
                {b.del > 0 && <span className="del">−{b.del}</span>}
              </span>
            </label>
            {lines.slice(from, to).map((l, i) => (
              <div key={i} className={'dl ' + (l.t === '+' ? 'add' : l.t === '-' ? 'del' : '')}>
                <span className="dg">{l.t === ' ' ? ' ' : l.t === '+' ? '+' : '−'}</span>
                {l.s || ' '}
              </div>
            ))}
          </div>
        )
      })}
      <div className="pick-f">
        <button className="btn sm pri" disabled={!on.size} onClick={() => onApply(applyPicked(lines, on))}>
          {on.size === blocks.length
            ? 'Применить всё'
            : `Применить выбранное (${on.size} из ${blocks.length})`}
        </button>
        <button className="btn sm gho" onClick={onReject}>
          Оставить как было
        </button>
      </div>
    </div>
  )
}

function TurnBar({ m, chatId }: { m: A; chatId: string }) {
  const t = m.turn!
  const files = (m.parts || []).filter((p): p is FilePart => p.k === 'file')
  const canRevert = files.some((f) => f.state === 'done')
  const st = useStore.getState
  const pending = files.filter((f) => f.state === 'proposed').length
  const kind = t.state === 'reverted' ? 'rev' : t.state === 'rejected' ? 'rej' : pending ? 'ask' : 'ok'
  return (
    <div className={'at-sum ' + kind}>
      <div className="sl">
        <Icon
          name={kind === 'ask' ? 'shield' : kind === 'rev' ? 'undo' : kind === 'rej' ? 'x' : 'check'}
          size={14}
        />
        <b>
          {pending
            ? `Ждёт решения · ${pending} из ${files.length}`
            : t.state === 'reverted'
              ? 'Правки отменены'
              : t.state === 'rejected'
                ? 'Правки отклонены'
                : t.version
                  ? `Версия v${t.version}`
                  : 'Готово'}
        </b>
        <span className="dot">·</span>
        <span>
          {t.files} {t.files === 1 ? 'файл' : t.files < 5 && t.files > 0 ? 'файла' : 'файлов'}
        </span>
        {(t.add > 0 || t.del > 0) && (
          <span className="cstat">
            <span className="add">+{t.add}</span>
            <span className="del">−{t.del}</span>
          </span>
        )}
      </div>
      <div className="sa">
        {pending > 0 && (
          <>
            <button className="btn sm pri" onClick={() => applyProposed(chatId, m.id)}>
              <Icon name="check" size={13} />
              Применить{pending > 1 ? ' все' : ''}
            </button>
            <button className="btn sm" onClick={() => rejectProposed(chatId, m.id)}>
              Отклонить
            </button>
          </>
        )}
        {(m.parts?.length ?? 0) > 1 && (
          <button
            className="btn sm gho"
            title="Пошаговое воспроизведение хода"
            onClick={() => st().openModal({ type: 'replay', chatId, msgId: m.id })}
          >
            <Icon name="play" size={12} />
            Запись
          </button>
        )}
        {t.version && t.state !== 'reverted' && (
          <button
            className="btn sm gho"
            onClick={() => st().openModal({ type: 'versions', focus: t.version })}
          >
            Дифф
          </button>
        )}
        {canRevert && (
          <button className="btn sm gho" onClick={() => revertTurn(chatId, m.id)}>
            <Icon name="undo" size={13} />
            Откатить
          </button>
        )}
      </div>
    </div>
  )
}
