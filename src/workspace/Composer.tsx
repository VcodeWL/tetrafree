import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Icon, BrandIcon } from '../components/ui/Icon'
import { Menu, MenuHead, MenuItem, MenuSep, useMenu } from '../components/ui/Menu'
import { sendMessage, stopTurn, resolveModel } from '../agent/engine'
import { useQueue, enqueue, dequeue, shiftQueue, moveQueued, prioritize } from '../agent/queue'
import type { Attachment } from '../types'
import { fmtBytes, uid } from '../lib/util'

const MAX = 8 * 1024 * 1024

export function ModelPicker({ place = 'top-start' }: { place?: 'top-start' | 'bottom-start' }) {
  const providers = useStore((s) => s.providers)
  const model = useStore((s) => s.model)
  const m = useMenu()
  const { label, live } = resolveModel()
  return (
    <>
      <button type="button" className="model-sel" onClick={m.open} aria-haspopup="menu">
        <span className="mdot" />
        {label}
        {live && (
          <span className="mtag live">
            {providers.find((p) => model.startsWith(p.id + ':'))?.kind === 'ollama' ? 'локально' : 'API'}
          </span>
        )}
        <Icon name="chevd" size={13} />
      </button>
      {m.st && (
        <Menu anchor={m.st.anchor} onClose={m.close} place={place} width={290}>
          {providers
            .filter((p) => p.on && p.models.length)
            .map((p) => (
              <div key={p.id}>
                <MenuHead>
                  <span className="bmark">
                    <BrandIcon kind={p.kind} size={12} />
                  </span>{' '}
                  {p.name}
                </MenuHead>
                {p.models.map((md) => {
                  const id = p.id + ':' + md.id
                  return (
                    <MenuItem
                      key={id}
                      sel={id === model}
                      icon={<span className="mdot" />}
                      label={md.name}
                      right={id === model ? '✓' : p.kind === 'ollama' ? 'локально' : ''}
                      onClick={() => {
                        useStore.getState().setModel(id)
                        m.close()
                      }}
                    />
                  )
                })}
              </div>
            ))}
          {!providers.some((p) => p.on && p.models.length) && (
            <div className="ddempty">
              {providers.length ? 'Нет включённых провайдеров с моделями' : 'Провайдеров пока нет'}
            </div>
          )}
          <MenuSep />
          <MenuItem
            icon="plus"
            label="Добавить провайдера"
            onClick={() => {
              m.close()
              useStore.getState().openModal({ type: 'provider' })
            }}
          />
          <MenuItem
            icon="gear"
            label="Провайдеры и ключи"
            onClick={() => {
              m.close()
              useStore.getState().openModal({ type: 'settings', section: 'providers' })
            }}
          />
        </Menu>
      )}
    </>
  )
}

export function Composer({
  chatId,
  running,
  placeholder,
}: {
  chatId: string
  running: boolean
  placeholder?: string
}) {
  const draft = useStore((s) => s.drafts[chatId] || '')
  const setDraft = useStore((s) => s.setDraft)
  const enterToSend = useStore((s) => s.settings.enterToSend)
  const [atts, setAtts] = useState<Attachment[]>([])
  const queue = useQueue((s) => s.q[chatId] || [])
  const [foc, setFoc] = useState(false)
  const [drag, setDrag] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const fileIn = useRef<HTMLInputElement>(null)
  const imgIn = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = ta.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = Math.min(150, t.scrollHeight) + 'px'
  }, [draft])
  useEffect(() => {
    ta.current?.focus()
  }, [chatId])
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail
      if (d?.chatId === chatId) {
        setDraft(chatId, d.text)
        setTimeout(() => {
          ta.current?.focus()
          ta.current?.setSelectionRange(d.text.length, d.text.length)
        })
      }
    }
    window.addEventListener('tf:compose', h)
    return () => window.removeEventListener('tf:compose', h)
  }, [chatId, setDraft])

  const add = (files: FileList | File[]) => {
    Array.from(files).forEach((f) => {
      if (f.size > MAX) {
        useStore.getState().toast({
          title: 'Файл слишком большой',
          desc: `${f.name} — ${fmtBytes(f.size)}, лимит 8 МБ`,
          tone: 'warn',
          icon: 'warn',
        })
        return
      }
      const a: Attachment = { id: uid('a'), name: f.name || 'вставка.png', size: f.size, mime: f.type }
      if (f.type.startsWith('image/')) {
        const r = new FileReader()
        r.onload = () => setAtts((x) => x.map((y) => (y.id === a.id ? { ...y, url: String(r.result) } : y)))
        r.readAsDataURL(f)
      }
      setAtts((x) => [...x, a].slice(0, 8))
    })
  }
  const send = () => {
    if (!draft.trim() && !atts.length) return
    if (running) {
      enqueue(chatId, draft.trim(), atts)
      setDraft(chatId, '')
      setAtts([])
      return
    }
    sendMessage(chatId, draft, atts)
    setAtts([])
  }
  return (
    <div className="composer">
      {queue.length > 0 && (
        <div className="queue" aria-label="Очередь сообщений">
          {queue.map((q, i) => (
            <div className="qitem" key={q.id}>
              <span className="qn">{i + 1}</span>
              <span className="qt">{q.text || 'Вложения: ' + q.atts.map((a) => a.name).join(', ')}</span>
              {i > 0 && (
                <button
                  type="button"
                  className="iconbtn sm"
                  title="Выше в очереди"
                  aria-label="Выше в очереди"
                  onClick={() => moveQueued(chatId, q.id, -1)}
                >
                  <Icon name="arrow" size={12} style={{ transform: 'rotate(-90deg)' }} />
                </button>
              )}
              {i > 1 && (
                <button
                  type="button"
                  className="linkbtn"
                  title="Поставить первым"
                  onClick={() => prioritize(chatId, q.id)}
                >
                  Срочно
                </button>
              )}
              {i < queue.length - 1 && (
                <button
                  type="button"
                  className="iconbtn sm"
                  title="Ниже в очереди"
                  aria-label="Ниже в очереди"
                  onClick={() => moveQueued(chatId, q.id, 1)}
                >
                  <Icon name="arrow" size={12} style={{ transform: 'rotate(90deg)' }} />
                </button>
              )}
              {i === 0 && running && (
                <button
                  type="button"
                  className="linkbtn"
                  title="Остановить агента и отправить сразу"
                  onClick={() => {
                    const nx = q
                    dequeue(chatId, q.id)
                    stopTurn(chatId)
                    setTimeout(() => sendMessage(chatId, nx.text, nx.atts), 400)
                  }}
                >
                  Сейчас
                </button>
              )}
              {!running && i === 0 && (
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => {
                    const nx = shiftQueue(chatId)
                    if (nx) sendMessage(chatId, nx.text, nx.atts)
                  }}
                >
                  Отправить
                </button>
              )}
              <button
                type="button"
                className="iconbtn sm"
                aria-label="Убрать из очереди"
                onClick={() => dequeue(chatId, q.id)}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        className={'comp-box' + (foc ? ' foc' : '') + (drag ? ' drag' : '')}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          add(e.dataTransfer.files)
        }}
      >
        {atts.length > 0 && (
          <div className="atts">
            {atts.map((a) => (
              <span key={a.id} className="att">
                {a.url ? (
                  <img src={a.url} alt="" className="att-img" />
                ) : (
                  <Icon name={a.mime.startsWith('image/') ? 'image' : 'file'} size={13} />
                )}
                <span className="att-n">{a.name}</span>
                <span className="t4">{fmtBytes(a.size)}</span>
                <span
                  className="x"
                  role="button"
                  aria-label="Убрать"
                  onClick={() => setAtts((x) => x.filter((y) => y.id !== a.id))}
                >
                  <Icon name="x" size={12} />
                </span>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={ta}
          rows={1}
          value={draft}
          placeholder={
            running
              ? 'Агент работает — сообщение встанет в очередь'
              : placeholder || 'Напиши агенту — @имя, чтобы обратиться к конкретному'
          }
          onFocus={() => setFoc(true)}
          onBlur={() => setFoc(false)}
          onChange={(e) => setDraft(chatId, e.target.value)}
          onPaste={(e) => {
            const f = Array.from(e.clipboardData.files)
            if (f.length) {
              e.preventDefault()
              add(f)
            }
          }}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.nativeEvent.isComposing &&
              ((enterToSend && !e.shiftKey) || (!enterToSend && (e.metaKey || e.ctrlKey)))
            ) {
              e.preventDefault()
              send()
            }
          }}
          aria-label="Сообщение"
        />
        <div className="comp-bar">
          <input
            ref={fileIn}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) add(e.target.files)
              e.target.value = ''
            }}
          />
          <input
            ref={imgIn}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) add(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="iconbtn"
            title="Прикрепить файл"
            aria-label="Прикрепить файл"
            onClick={() => fileIn.current?.click()}
          >
            <Icon name="attach" size={17} />
          </button>
          <button
            type="button"
            className="iconbtn"
            title="Добавить фото"
            aria-label="Добавить фото"
            onClick={() => imgIn.current?.click()}
          >
            <Icon name="image" size={17} />
          </button>
          <ModelPicker />
          <span className="comp-hint">
            {enterToSend ? 'Enter — отправить · Shift+Enter — строка' : 'Ctrl+Enter — отправить'}
          </span>
          {running && (draft.trim() || atts.length > 0) && (
            <button
              type="button"
              className="btn pri send"
              onClick={send}
              aria-label="В очередь"
              title="Отправить после текущего хода"
            >
              <Icon name="send" size={17} />
            </button>
          )}
          {running ? (
            <button
              type="button"
              className="btn send stopb"
              onClick={() => stopTurn(chatId)}
              aria-label="Остановить"
            >
              <Icon name="stop" size={15} />
            </button>
          ) : (
            <button
              type="button"
              className="btn pri send"
              onClick={send}
              disabled={!draft.trim() && !atts.length}
              aria-label="Отправить"
            >
              <Icon name="send" size={17} />
            </button>
          )}
        </div>
        {drag && (
          <div className="dropzone">
            <Icon name="upload" size={20} />
            Отпусти, чтобы прикрепить
          </div>
        )}
      </div>
    </div>
  )
}
