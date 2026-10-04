import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore, useProject, getProject } from '../store'
import type { Chat, Message, Tier } from '../types'
import { TIERS } from '../types'
import { AgentAvatar, Avatar, Inline, PersonAv, Working } from '../components/ui/primitives'
import { Icon } from '../components/ui/Icon'
import { Markdown } from '../components/ui/Markdown'
import { plural } from '../lib/util'
import { Menu, MenuHead, MenuItem, useMenu } from '../components/ui/Menu'
import { CopyBtn } from '../components/ui/CopyBtn'
import { Composer } from './Composer'
import { AgentTurn } from './AgentTurn'
import { isRunning } from '../agent/engine'
import { AGENTS, PRIMARY_AGENTS } from '../data/seed'
import { ago, clock, fmtBytes, localDay } from '../lib/util'

const dayLabel = (ts: number) => {
  const d = new Date(ts),
    t = new Date()
  if (localDay(d) === localDay(t)) return 'Сегодня'
  const y = new Date(t)
  y.setDate(t.getDate() - 1)
  if (localDay(d) === localDay(y)) return 'Вчера'
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== t.getFullYear() ? { year: 'numeric' } : {}),
  })
}

const TIER_DESC: Record<Tier, string> = {
  Тихо: 'делает всё сам, без уведомлений',
  Уведомить: 'делает сам и сообщает о результате',
  Спросить: 'спрашивает перед рискованными действиями',
  Эскалация: 'спрашивает перед любой правкой файлов',
}

export function ChatView({ chat }: { chat: Chat }) {
  const p = useProject()!
  const st = useStore.getState
  const rightOpen = useStore((s) => s.rightOpen)
  const lanes = p.lanes
  const others = lanes.filter((l) => l.chatId !== chat.id)
  const mine = lanes.filter((l) => l.chatId === chat.id)
  const conflicts = mine.reduce(
    (n, a) =>
      n +
      others.filter(
        (b) =>
          a.mode === 'write' &&
          b.mode === 'write' &&
          a.lease !== '—' &&
          b.lease !== '—' &&
          (a.lease.startsWith(b.lease) || b.lease.startsWith(a.lease)),
      ).length,
    0,
  )
  const creator =
    chat.creator.kind === 'agent'
      ? 'агент ' + chat.creator.name
      : useStore.getState().people[chat.creator.id]?.name
  const busy = chat.running && isRunning(chat.id)
  return (
    <div className="cwrap">
      <div className="cbar">
        <div className="tl">
          <div className="ttl">
            {chat.title}
            {chat.running && <Working />}
          </div>
          <div className="meta">
            <span>{creator}</span>
            <span className="vr" />
            <span>{ago(chat.createdAt)}</span>
            <span className="vr" />
            <span>{chat.messages.filter((m) => m.kind !== 'sys').length} сообщ.</span>
          </div>
        </div>
        <div className="grow" />
        {mine.length > 0 && others.length > 0 && (
          <button
            className={'conf' + (conflicts ? ' bad' : '')}
            onClick={() => st().openModal({ type: 'activity' })}
            title={`Агентов в других чатах: ${others.length}. Конфликт — когда двое пишут в пересекающиеся файлы.`}
          >
            <Icon name="users" size={13} />
            {conflicts
              ? `${conflicts} ${plural(conflicts, ['конфликт', 'конфликта', 'конфликтов'])}`
              : 'без конфликтов'}
          </button>
        )}
        <div
          className="avstack cmembers"
          role="button"
          onClick={() => st().openModal({ type: 'settings', section: 'members' })}
          title="Участники проекта"
        >
          {p.members.slice(0, 3).map((m) => (
            <PersonAv key={m} id={m} size={24} />
          ))}
        </div>
        <button
          className="iconbtn"
          title="Активность агентов"
          onClick={() => st().openModal({ type: 'activity' })}
        >
          <Icon name="bolt" size={16} />
        </button>
        <button
          className={'iconbtn' + (rightOpen ? ' on' : '')}
          title={rightOpen ? 'Скрыть панель кода' : 'Показать панель кода'}
          onClick={() => st().setRight({ rightOpen: !rightOpen })}
        >
          <Icon name="sidebar" size={16} style={{ transform: 'scaleX(-1)' }} />
        </button>
      </div>
      <AgentStrip chat={chat} />
      <Thread chat={chat} />
      <Composer
        chatId={chat.id}
        running={busy}
        placeholder={chat.agents.length ? undefined : 'Сначала добавь агента в чат'}
      />
    </div>
  )
}

function AgentStrip({ chat }: { chat: Chat }) {
  const st = useStore.getState
  const tierM = useMenu<number>()
  const addM = useMenu()
  const nodeM = useMenu<number>()
  const setAgents = (fn: (a: Chat['agents']) => Chat['agents']) =>
    st().setChat(chat.id, { agents: fn(structuredClone(chat.agents)) })
  const missing = PRIMARY_AGENTS.filter((a) => !chat.agents.some((x) => x.name === a))
  return (
    <div className="astrip">
      <span className="lab">Агенты</span>
      {chat.agents.map((a, i) => (
        <div key={a.name} className="subrow">
          <div className="anode" onContextMenu={(e) => nodeM.at(e, i)}>
            <AgentAvatar name={a.name} size={24} />
            <span className="an">{a.name}</span>
            <button
              className="chip sm btnlike tierchip"
              onClick={(e) => tierM.open(e, i)}
              title={TIER_DESC[a.tier]}
            >
              {a.tier}
              <Icon name="chevd" size={10} />
            </button>
          </div>
        </div>
      ))}
      <button className="aadd" onClick={addM.open}>
        <Icon name="plus" size={13} />
        {chat.agents.length ? 'Агент' : 'Добавить агента'}
      </button>
      {tierM.st && (
        <Menu anchor={tierM.st.anchor} onClose={tierM.close} width={300}>
          <MenuHead>Уровень автономии · {chat.agents[tierM.st.data]?.name}</MenuHead>
          {TIERS.map((t) => (
            <MenuItem
              key={t}
              sel={chat.agents[tierM.st!.data]?.tier === t}
              onClick={() => {
                const i = tierM.st!.data
                setAgents((ag) => {
                  ag[i].tier = t
                  return ag
                })
                tierM.close()
                st().pushMsg(chat.id, {
                  id: 'm' + Date.now(),
                  kind: 'sys',
                  text: `Уровень **${chat.agents[i].name}** → «${t}»: ${TIER_DESC[t]}`,
                  at: Date.now(),
                })
              }}
            >
              <div className="ddtwo">
                <b>{t}</b>
                <span>{TIER_DESC[t]}</span>
              </div>
              {chat.agents[tierM.st!.data]?.tier === t && <Icon name="check" size={14} />}
            </MenuItem>
          ))}
        </Menu>
      )}
      {nodeM.st && (
        <Menu anchor={nodeM.st.anchor} onClose={nodeM.close}>
          <MenuItem
            icon="x"
            label={'Убрать ' + chat.agents[nodeM.st.data]?.name + ' из чата'}
            danger
            onClick={() => {
              const i = nodeM.st!.data
              setAgents((ag) => ag.filter((_, j) => j !== i))
              nodeM.close()
            }}
          />
        </Menu>
      )}
      {addM.st && (
        <Menu anchor={addM.st.anchor} onClose={addM.close} width={290}>
          {missing.length > 0 && <MenuHead>Агенты</MenuHead>}
          {missing.map((a) => (
            <MenuItem
              key={a}
              icon={<AgentAvatar name={a} size={22} />}
              onClick={() => {
                setAgents((ag) => [...ag, { name: a, tier: 'Спросить', sub: [] }])
                addM.close()
              }}
            >
              <div className="ddtwo">
                <b>{a}</b>
                <span>{AGENTS[a]?.role}</span>
              </div>
            </MenuItem>
          ))}
          {!missing.length && <div className="ddempty">Все агенты уже в чате</div>}
        </Menu>
      )}
    </div>
  )
}

function Thread({ chat }: { chat: Chat }) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [showDown, setShowDown] = useState(false)
  const pins = chat.messages.filter(
    (m): m is Extract<Message, { kind: 'human' }> => m.kind === 'human' && !!m.pinned,
  )
  const [pinI, setPinI] = useState(0)
  const [find, setFind] = useState<string | null>(null)
  const [cur, setCur] = useState(0)
  const [total, setTotal] = useState(0)
  const rangesRef = useRef<Range[]>([])
  useEffect(() => {
    setFind(null)
  }, [chat.id])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.code === 'KeyF' &&
        ref.current &&
        !(e.target as HTMLElement)?.closest?.('.code-body, .cm-editor')
      ) {
        e.preventDefault()
        setFind((f) => f ?? '')
        setTimeout(() => document.querySelector<HTMLInputElement>('.tfind input')?.select(), 0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const msgCount = chat.messages.length
  useEffect(() => {
    const hl = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    const root = ref.current
    rangesRef.current = []
    hl?.delete('tf-find')
    hl?.delete('tf-find-cur')
    if (!root || !find || find.length < 2) {
      setTotal(0)
      return
    }
    const q = find.toLowerCase(),
      out: Range[] = []
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n && out.length < 500; n = w.nextNode()) {
      const t = (n.textContent || '').toLowerCase()
      for (let i = t.indexOf(q); i >= 0 && out.length < 500; i = t.indexOf(q, i + q.length)) {
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, i + q.length)
        out.push(r)
      }
    }
    rangesRef.current = out
    setTotal(out.length)
    setCur((c) => Math.min(c, Math.max(0, out.length - 1)))
  }, [find, msgCount])
  useEffect(() => {
    const hl = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    const HL = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
    const rs = rangesRef.current
    if (!hl || !HL || !rs.length) return
    hl.set('tf-find', new HL(...rs))
    hl.set('tf-find-cur', new HL(rs[cur] || rs[0]))
    rs[cur]?.startContainer.parentElement?.scrollIntoView({ block: 'center' })
    return () => {
      hl.delete('tf-find')
      hl.delete('tf-find-cur')
    }
  }, [cur, total, find])
  const step = (d: number) => {
    if (total) setCur((c) => (c + d + total) % total)
  }
  const last = chat.messages[chat.messages.length - 1]
  const sig =
    chat.messages.length +
    ':' +
    (last && 'text' in last ? last.text.length : 0) +
    ':' +
    (last?.kind === 'agent'
      ? (last.parts?.length || 0) +
        ':' +
        (last.parts?.reduce(
          (a, p) => a + (p.k === 'cmd' ? p.out.length : p.k === 'file' ? p.lines || 0 : 0),
          0,
        ) || 0) +
        ':' +
        (last.turn ? 1 : 0)
      : '') +
    ''
  useLayoutEffect(() => {
    const el = ref.current
    if (el) {
      el.style.scrollBehavior = 'auto'
      el.scrollTop = el.scrollHeight
      el.style.scrollBehavior = ''
    }
    stick.current = true
  }, [chat.id])
  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [sig])
  return (
    <div className={'thread-wrap' + (pins.length > 0 && find === null ? ' haspin' : '')}>
      <div
        className="thread"
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          stick.current = near
          setShowDown(!near)
        }}
      >
        {chat.messages.map((m, i) => {
          const prev = chat.messages[i - 1]
          const sep = !prev || localDay(new Date(prev.at)) !== localDay(new Date(m.at))
          return (
            <Fragment key={m.id}>
              {sep && (
                <div className="dsep">
                  <span>{dayLabel(m.at)}</span>
                </div>
              )}
              <Msg m={m} chatId={chat.id} />
            </Fragment>
          )
        })}
      </div>
      {pins.length > 0 && find === null && (
        <div className="pinstrip">
          <Icon name="pin" size={12} />
          <button
            className="pin-t"
            onClick={() => {
              const m = pins[pinI % pins.length]
              setPinI((i) => i + 1)
              const el = ref.current?.querySelector<HTMLElement>(`[data-mid="${m.id}"]`)
              el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
              el?.classList.remove('flash')
              void el?.offsetWidth
              el?.classList.add('flash')
            }}
            title="Перейти к сообщению"
          >
            {(pins[pinI % pins.length] as { text: string }).text.replace(/\s+/g, ' ').slice(0, 140)}
          </button>
          {pins.length > 1 && (
            <span className="t4">
              {(pinI % pins.length) + 1} из {pins.length}
            </span>
          )}
          <button
            className="iconbtn sm"
            aria-label="Открепить"
            title="Открепить"
            onClick={() => {
              const m = pins[pinI % pins.length]
              useStore.getState().patchMsg(chat.id, m.id, { pinned: false })
            }}
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
      {find !== null && (
        <div className="tfind" role="search">
          <Icon name="search" size={14} />
          <input
            autoFocus
            value={find}
            placeholder="Найти в чате"
            aria-label="Поиск в чате"
            onChange={(e) => {
              setFind(e.target.value)
              setCur(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setFind(null)
              } else if (e.key === 'Enter') {
                e.preventDefault()
                step(e.shiftKey ? -1 : 1)
              }
            }}
          />
          <span className="t4">
            {find.length < 2 ? '' : total ? `${cur + 1} из ${total}` : 'нет совпадений'}
          </span>
          <button className="iconbtn sm" onClick={() => step(-1)} disabled={!total} aria-label="Предыдущее">
            <Icon name="chev" size={13} style={{ transform: 'rotate(-90deg)' }} />
          </button>
          <button className="iconbtn sm" onClick={() => step(1)} disabled={!total} aria-label="Следующее">
            <Icon name="chev" size={13} style={{ transform: 'rotate(90deg)' }} />
          </button>
          <button className="iconbtn sm" onClick={() => setFind(null)} aria-label="Закрыть поиск">
            <Icon name="x" size={13} />
          </button>
        </div>
      )}
      {showDown && (
        <button
          className="todown"
          onClick={() => {
            const el = ref.current!
            el.scrollTop = el.scrollHeight
          }}
          aria-label="К последнему сообщению"
        >
          <Icon name="arrowdown" size={15} />
        </button>
      )}
    </div>
  )
}

function MsgActions({ m, chatId }: { m: Extract<Message, { kind: 'human' }>; chatId: string }) {
  const st = useStore.getState
  const quote = () => {
    const first = m.text.split('\n').filter(Boolean).slice(0, 3).join('\n> ')
    const cur = st().drafts[chatId] || ''
    window.dispatchEvent(
      new CustomEvent('tf:compose', {
        detail: {
          chatId,
          text:
            (cur ? cur.replace(/\n*$/, '\n\n') : '') +
            '> ' +
            (first.length > 280 ? first.slice(0, 280) + '…' : first) +
            '\n\n',
        },
      }),
    )
  }
  const toTask = () => {
    const title =
      m.text
        .split('\n')
        .find((x) => x.trim())!
        .replace(/^[#>*\-\s]+/, '')
        .slice(0, 90) || 'Задача из чата'
    const id = st().saveTask({
      title,
      desc: m.text.length > 90 || m.text.includes('\n') ? m.text : '',
      status: 'backlog',
    })
    const key = getProject()?.tasks.find((t) => t.id === id)?.key
    st().toast({
      title: 'Задача создана',
      desc: (key ? '#' + key + ' · ' : '') + title,
      icon: 'task',
      tone: 'ok',
      action: { label: 'Открыть', run: () => st().openModal({ type: 'task', id }) },
    })
  }
  return (
    <>
      <button className="msg-copy" title="Ответить цитатой" aria-label="Ответить цитатой" onClick={quote}>
        <Icon name="quote" size={12} />
      </button>
      <button
        className="msg-copy"
        title="Создать задачу из сообщения"
        aria-label="Создать задачу из сообщения"
        onClick={toTask}
      >
        <Icon name="task" size={12} />
      </button>
      <button
        className={'msg-copy' + (m.pinned ? ' ok' : '')}
        title={m.pinned ? 'Открепить сообщение' : 'Закрепить сообщение'}
        aria-label={m.pinned ? 'Открепить сообщение' : 'Закрепить сообщение'}
        onClick={() => st().patchMsg(chatId, m.id, { pinned: !m.pinned })}
      >
        <Icon name="pin" size={12} />
      </button>
    </>
  )
}

const Msg = memo(function Msg({ m, chatId }: { m: Message; chatId: string }) {
  const people = useStore((s) => s.people)
  if (m.kind === 'sys')
    return (
      <div className="sysline">
        <Icon name="sparkle" size={13} />
        <span>
          <Inline text={m.text} />
        </span>
      </div>
    )
  if (m.kind === 'human') {
    const me = m.author === 'me'
    const who = people[m.author]
    return (
      <div className={'turn' + (me ? ' me' : '')} data-mid={m.id}>
        {!me && <Avatar person={who} size={32} />}
        <div className="body">
          <div className="nm">
            <span className="who-n">{me ? 'Ты' : who?.name}</span>
            <span>{clock(m.at)}</span>
            {m.text && <CopyBtn text={m.text} />}
            {m.text && <MsgActions m={m} chatId={chatId} />}
          </div>
          {m.text && (
            <div className="bubble">
              <Markdown text={m.text} />
            </div>
          )}
          {m.attachments && (
            <div className="matts">
              {m.attachments.map((a) =>
                a.url && a.mime.startsWith('image/') ? (
                  <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="mimg">
                    <img src={a.url} alt={a.name} />
                  </a>
                ) : (
                  <span key={a.id} className="att">
                    <Icon name="file" size={13} />
                    {a.name}
                    <span className="t4">{fmtBytes(a.size)}</span>
                  </span>
                ),
              )}
            </div>
          )}
        </div>
      </div>
    )
  }
  if (m.kind === 'agent') return <AgentTurn m={m} chatId={chatId} />
  return null
})
