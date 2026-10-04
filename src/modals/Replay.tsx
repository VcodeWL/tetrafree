import { useEffect, useMemo, useRef, useState } from 'react'
import { useProject } from '../store'
import { Icon } from '../components/ui/Icon'
import { Modal, MHead } from '../components/ui/Modal'
import { Markdown } from '../components/ui/Markdown'
import { compact, diffStat } from '../lib/diff'
import { buildReplay, delayFor, fmtOffset, SPEEDS, type ReplayEv } from '../lib/replay'
import type { Message, Part } from '../types'

const OP: Record<string, string> = {
  create: 'Создаёт файл',
  edit: 'Правит файл',
  delete: 'Удаляет файл',
  rename: 'Переименовывает',
}

function Stage({ part }: { part: Part }) {
  if (part.k === 'step')
    return (
      <div className="rp-big">
        <Icon name="bolt" size={18} />
        <span>{part.text}</span>
      </div>
    )
  if (part.k === 'read')
    return (
      <div className="rp-big">
        <Icon name="eye" size={18} />
        <span>
          Читает <code>{part.path}</code>
          {!part.ok && ' — не найден'}
        </span>
      </div>
    )
  if (part.k === 'text') return <Markdown text={part.text} />
  if (part.k === 'cmd')
    return (
      <div className="rp-cmd">
        <div className="rp-cmd-h">
          <Icon name="terminal" size={13} />
          <code>{part.cmd}</code>
          <span className={'rp-code ' + (part.state === 'error' ? 'err' : '')}>
            {part.state === 'running' ? 'не завершена' : `код ${part.code ?? 0}`}
          </span>
        </div>
        <pre>{part.out || '(нет вывода)'}</pre>
      </div>
    )
  const a = part.op === 'delete' ? part.before : (part.before ?? ''),
    b = part.op === 'delete' ? '' : part.after
  const rows = a != null && b != null ? compact(diffStat(a, b).lines, 2).slice(0, 300) : null
  return (
    <div className="rp-file">
      <div className="rp-big">
        <Icon name={part.op === 'delete' ? 'trash' : part.op === 'create' ? 'plus' : 'pen'} size={18} />
        <span>
          {OP[part.op] ?? 'Файл'} <code>{part.path}</code>
          {part.to && (
            <>
              {' '}
              → <code>{part.to}</code>
            </>
          )}
        </span>
        <span className="cstat">
          {part.add > 0 && <span className="add">+{part.add}</span>}
          {part.del > 0 && <span className="del">−{part.del}</span>}
        </span>
      </div>
      <div className="cdiff">
        {rows === null && (
          <div className="dnote">Дифф не сохранён (файл слишком большой или не применён).</div>
        )}
        {rows?.map((l, i) =>
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
    </div>
  )
}

const label = (e: ReplayEv) => {
  const p = e.part
  return p.k === 'step'
    ? p.text
    : p.k === 'read'
      ? 'Читает ' + p.path
      : p.k === 'cmd'
        ? '$ ' + p.cmd
        : p.k === 'file'
          ? (OP[p.op] ?? 'Файл') + ' ' + p.path
          : 'Ответ'
}
const icon = (e: ReplayEv) => {
  const k = e.part.k
  return k === 'step'
    ? 'bolt'
    : k === 'read'
      ? 'eye'
      : k === 'cmd'
        ? 'terminal'
        : k === 'file'
          ? 'pen'
          : 'chat'
}

export function ReplayModal({ chatId, msgId }: { chatId: string; msgId: string }) {
  const p = useProject()
  const msg = p?.chats.find((c) => c.id === chatId)?.messages.find((m) => m.id === msgId) as
    Extract<Message, { kind: 'agent' }> | undefined
  const ev = useMemo(() => buildReplay(msg?.parts ?? []), [msg?.parts])
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<number>(1)
  const box = useRef<HTMLDivElement>(null)
  const last = ev.length - 1

  useEffect(() => {
    if (!playing) return
    if (i >= last) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setI((x) => Math.min(last, x + 1)), delayFor(ev, i + 1, speed))
    return () => clearTimeout(t)
  }, [playing, i, speed, ev, last])
  useEffect(() => {
    box.current?.querySelector('.rp-it.cur')?.scrollIntoView({ block: 'nearest' })
  }, [i])

  const go = (n: number) => {
    setPlaying(false)
    setI(Math.max(0, Math.min(last, n)))
  }
  const toggle = () => {
    if (!playing && i >= last) setI(0)
    setPlaying((v) => !v)
  }
  const cur = ev[i]
  return (
    <Modal wide label="Запись хода агента">
      <MHead
        icon="play"
        title="Запись хода агента"
        sub={
          ev.length ? `${msg?.agent ?? 'Агент'} · событий: ${ev.length}` : 'В этом ходе нет записанных шагов.'
        }
      />
      {cur && (
        <div
          className="rp"
          ref={box}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') go(i - 1)
            else if (e.key === 'ArrowRight') go(i + 1)
            else if (e.key === ' ' && !(e.target as HTMLElement).closest('button,input')) {
              e.preventDefault()
              toggle()
            } else return
            e.stopPropagation()
          }}
        >
          <div className="rp-list" role="listbox" aria-label="События хода">
            {ev.map((e, n) => (
              <button
                key={e.part.id}
                role="option"
                aria-selected={n === i}
                className={'rp-it' + (n === i ? ' cur' : n < i ? ' past' : '')}
                onClick={() => go(n)}
              >
                <Icon name={icon(e)} size={12} />
                <span className="rp-lab">{label(e)}</span>
                <span className="rp-at">{fmtOffset(e.at)}</span>
              </button>
            ))}
          </div>
          <div className="rp-stage" key={cur.part.id} aria-live="polite">
            <Stage part={cur.part} />
          </div>
          <div className="rp-bar">
            <button className="iconbtn" onClick={() => go(0)} aria-label="В начало" disabled={i === 0}>
              <Icon name="undo" size={14} />
            </button>
            <button className="iconbtn" onClick={() => go(i - 1)} aria-label="Шаг назад" disabled={i === 0}>
              <Icon name="chevl" size={14} />
            </button>
            <button className="btn sm pri rp-play" onClick={toggle}>
              <Icon name={playing ? 'stop' : 'play'} size={13} />
              {playing ? 'Пауза' : i >= last ? 'Заново' : 'Играть'}
            </button>
            <button
              className="iconbtn"
              onClick={() => go(i + 1)}
              aria-label="Шаг вперёд"
              disabled={i >= last}
            >
              <Icon name="chev" size={14} />
            </button>
            <input
              type="range"
              min={0}
              max={last}
              value={i}
              aria-label="Позиция записи"
              onChange={(e) => go(+e.target.value)}
            />
            <span className="rp-n">
              {i + 1} / {ev.length}
            </span>
            <button
              className="btn sm gho"
              title="Скорость"
              onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s as 1) + 1) % SPEEDS.length])}
            >
              {speed}×
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
