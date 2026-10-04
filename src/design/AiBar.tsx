import { useMemo, useRef, useState } from 'react'
import { useStore, useProject, getChat } from '../store'
import { useDesign } from './store'
import { getEl } from './actions'
import { describe } from './dom'
import { ModelPicker } from '../workspace/Composer'
import { sendMessage, stopTurn, revertTurn } from '../agent/engine'
import { Icon } from '../components/ui/Icon'
import { AgentAvatar, Spin } from '../components/ui/primitives'
import type { Message } from '../types'

const IDEAS = ['Сделай светлую тему', 'Акцент — бирюзовый', 'Добавь секцию с тарифами', 'Кнопки мягче']

function cssPath(el: Element) {
  const out: string[] = []
  let cur: Element | null = el
  while (cur && cur.tagName !== 'BODY') {
    out.unshift(describe(cur))
    cur = cur.parentElement
  }
  return out.join(' > ')
}

export function designChatId(create = false) {
  const st = useStore.getState()
  const p = st.projects.find((x) => x.id === st.projectId)!
  let c = p.chats.find((x) => x.title === 'Дизайн' && x.agents[0]?.name === 'designer')
  if (!c && create) {
    const id = st.createChat({
      title: 'Дизайн',
      creator: { kind: 'human', id: 'me' },
      agents: [{ name: 'designer', tier: 'Тихо', sub: [] }],
    })
    st.setCenter({ kind: 'empty' })
    void id
    c = useStore
      .getState()
      .projects.find((x) => x.id === st.projectId)!
      .chats.find((x) => x.title === 'Дизайн')
  }
  return c?.id
}

export function AiBar({ page }: { page: string }) {
  const p = useProject()!
  const sel = useDesign((s) => s.sel)
  useDesign((s) => s.rev)
  const [v, setV] = useState('')
  const [dismissed, setDismissed] = useState<string | null>(null)
  const ta = useRef<HTMLTextAreaElement>(null)
  const chat = p.chats.find((c) => c.title === 'Дизайн' && c.agents[0]?.name === 'designer')
  const running = !!chat?.running
  const last = useMemo(
    () =>
      [...(chat?.messages || [])]
        .reverse()
        .find((m): m is Extract<Message, { kind: 'agent' }> => m.kind === 'agent'),
    [chat?.messages],
  )
  const el = sel ? getEl(sel) : null

  const send = (text: string) => {
    const t = text.trim()
    if (!t || running) return
    const id = designChatId(true)
    if (!id) return
    const ctx =
      `[Контекст режима «Дизайн»] Открыта страница ${page}. Файл — единственный источник правды: правь его тегами, предпочитай <edit> (точечные замены), не переписывай всю страницу ради мелочи. Стили держи в <style> страницы или inline.` +
      (el
        ? `\nПользователь выбрал на холсте элемент ${cssPath(el)}. Его HTML:\n${el.outerHTML.slice(0, 1800)}\nВопрос относится к нему, если не сказано иное.`
        : '')
    setDismissed(null)
    setV('')
    sendMessage(id, t, [], ctx)
  }

  let status = ''
  if (running && last?.streaming) {
    const w = last.parts?.find((x) => x.k === 'file' && x.state === 'writing')
    const s = [...(last.parts || [])].reverse().find((x) => x.k === 'step' && !x.done)
    status =
      w && w.k === 'file'
        ? `Правит ${w.path.split('/').pop()}`
        : s && s.k === 'step'
          ? s.text
          : last.thinking || 'Работает'
  }
  const showResult =
    !running && last && chat && dismissed !== last.id && Date.now() - (last.endedAt || last.at) < 5 * 60_000
  const resText =
    last?.parts
      ?.filter((x) => x.k === 'text')
      .map((x) => (x.k === 'text' ? x.text : ''))
      .join(' ')
      .replace(/[*`#>]/g, '')
      .trim() ||
    last?.text ||
    ''
  return (
    <div className="dai" onPointerDown={(e) => e.stopPropagation()}>
      {running && (
        <div className="dai-s">
          <Spin size={13} />
          <AgentAvatar name="designer" size={18} />
          <b>designer</b>
          <span>{status}</span>
          <span className="grow" />
          <button className="btn sm" onClick={() => chat && stopTurn(chat.id)}>
            <Icon name="stop" size={12} />
            Стоп
          </button>
        </div>
      )}
      {showResult && last && (
        <div className="dai-r">
          <Icon name={last.error ? 'warn' : 'check'} size={14} />
          <span className="rt">
            {resText.slice(0, 170)}
            {resText.length > 170 ? '…' : ''}
          </span>
          {last.turn && last.turn.files > 0 && (
            <span className="t4 mono">
              v{last.turn.version ?? '…'} · +{last.turn.add} −{last.turn.del}
            </span>
          )}
          {last.turn?.state === 'applied' && (
            <button className="linkbtn" onClick={() => chat && revertTurn(chat.id, last.id)}>
              Откатить
            </button>
          )}
          <button className="iconbtn sm" aria-label="Скрыть" onClick={() => setDismissed(last.id)}>
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
      <div className={'dai-box' + (running ? ' busy' : '')}>
        {el && (
          <div className="dai-ctx">
            <Icon name="cursor" size={11} />
            {describe(el)}
            <button aria-label="Снять выбор" onClick={() => useDesign.setState({ sel: null })}>
              <Icon name="x" size={10} />
            </button>
          </div>
        )}
        <textarea
          ref={ta}
          rows={1}
          value={v}
          placeholder={
            el
              ? `Что сделать с «${describe(el)}»?`
              : 'Опиши, что изменить на странице — дизайнер поправит файл'
          }
          disabled={running}
          onChange={(e) => {
            setV(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px'
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(v)
            }
          }}
        />
        <div className="dai-bar">
          <ModelPicker place="top-start" />
          {!v && !running && (
            <div className="dai-ideas">
              {IDEAS.map((i) => (
                <button key={i} onClick={() => send(i)}>
                  {i}
                </button>
              ))}
            </div>
          )}
          <span className="grow" />
          {chat && (
            <button
              className="iconbtn sm"
              title="Открыть чат «Дизайн»"
              onClick={() => {
                const st = useStore.getState()
                st.setMode('dev')
                st.setCenter({ kind: 'chat', id: chat.id })
              }}
            >
              <Icon name="chat" size={14} />
            </button>
          )}
          <button
            className="btn pri send"
            disabled={!v.trim() || running}
            onClick={() => send(v)}
            aria-label="Отправить"
          >
            <Icon name="send" size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
void getChat
