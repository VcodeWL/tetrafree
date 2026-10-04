import { useState } from 'react'
import { useStore, useProject, toast } from '../store'
import { Icon } from '../components/ui/Icon'
import { AgentAvatar } from '../components/ui/primitives'
import { Modal, MHead } from '../components/ui/Modal'
import { ago } from '../lib/util'
import { ME } from '../data/seed'

export function ActivityModal() {
  const p = useProject()!
  const st = useStore.getState
  const [tab, setTab] = useState<'lanes' | 'memory'>('lanes')
  const [fact, setFact] = useState('')
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null)
  const saveEdit = () => {
    if (!edit) return
    if (edit.text.trim()) st().editMemory(edit.id, { text: edit.text })
    setEdit(null)
  }
  const goChat = (id?: string) => {
    if (!id || !p.chats.some((c) => c.id === id)) return
    st().setCenter({ kind: 'chat', id })
    st().closeModal()
  }
  const mem = p.memory.filter((m) => !q || m.text.toLowerCase().includes(q.toLowerCase()))
  const add = () => {
    if (!fact.trim()) return
    st().remember({ text: fact.trim(), by: st().people[ME].name, kind: 'fact' })
    setFact('')
    toast({ title: 'Добавлено в память проекта', icon: 'check', tone: 'ok' })
  }
  return (
    <Modal wide label="Активность агентов">
      <MHead
        icon="bolt"
        title="Активность агентов"
        sub="Кто сейчас что делает, какие файлы заняты и что агенты уже знают о проекте."
      />
      <div className="segmini tabs">
        <button className={tab === 'lanes' ? 'on' : ''} onClick={() => setTab('lanes')}>
          <Icon name="bolt" size={13} />
          Сейчас<span className="count">{p.lanes.length}</span>
        </button>
        <button className={tab === 'memory' ? 'on' : ''} onClick={() => setTab('memory')}>
          <Icon name="layers" size={13} />
          Память проекта<span className="count">{p.memory.length}</span>
        </button>
      </div>
      {tab === 'lanes' ? (
        <>
          {!p.lanes.length && (
            <div className="act-empty">
              <Icon name="check" size={18} />
              <div>
                <b>Все агенты свободны</b>
                <span>
                  Напиши задачу в любом чате — здесь появится дорожка с прогрессом и захваченными файлами.
                </span>
              </div>
            </div>
          )}
          <div className="lanes">
            {p.lanes.map((l) => (
              <div className="lane" key={l.id}>
                <div className="lane-h">
                  <AgentAvatar name={l.who} size={30} />
                  <div className="lane-hx">
                    <div className="lane-who">
                      {l.who}
                      <span className={'lmode ' + l.mode}>{l.mode === 'write' ? 'пишет' : 'читает'}</span>
                    </div>
                    <div className="lane-act">{l.act}</div>
                  </div>
                  <span className="lease-chip" title="Файл заблокирован для записи другими агентами">
                    <Icon name={l.mode === 'write' ? 'lock' : 'eye'} size={11} />
                    {l.lease}
                  </span>
                </div>
                <div className="lane-track">
                  <div
                    className={'lane-fill' + (l.mode === 'read' ? ' read' : '')}
                    style={{ width: Math.round(l.pct) + '%' }}
                  />
                </div>
                <div className="lane-foot">
                  <button className="lane-chat linkbtn" onClick={() => goChat(l.chatId)}>
                    <Icon name="chat" size={12} />
                    {l.chat}
                  </button>
                  <span className="dim mono">{Math.round(l.pct)}%</span>
                  {!!l.subs.length && (
                    <div className="lane-subs">
                      {l.subs.map((s) => (
                        <span key={s} className="subtag">
                          <Icon name="tree" size={10} />
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="lane-legend">
            <Icon name="info" size={14} />
            Lease — временная блокировка файла: пока агент пишет, другие чаты его только читают. Когда запись
            закончена, остальные агенты получают системное сообщение с изменениями.
          </div>
        </>
      ) : (
        <>
          <div className="mem-bar">
            <div className="xs">
              <Icon name="search" size={13} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по памяти" />
            </div>
          </div>
          <div className="mem-add">
            <input
              value={fact}
              onChange={(e) => setFact(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="Добавить факт: например, «деплой только по пятницам до 16:00»"
            />
            <button className="btn sm" disabled={!fact.trim()} onClick={add}>
              <Icon name="plus" size={13} />
              Запомнить
            </button>
          </div>
          <div className="mem-list">
            {mem.map((m) => (
              <div className="mem" key={m.id}>
                <button
                  className={'mem-k ' + m.kind}
                  title="Сменить: факт / решение"
                  aria-label={`Тип записи: ${m.kind === 'decision' ? 'решение' : 'факт'}. Сменить`}
                  onClick={() => st().editMemory(m.id, { kind: m.kind === 'decision' ? 'fact' : 'decision' })}
                >
                  {m.kind === 'decision' ? 'решение' : 'факт'}
                </button>
                <div className="mem-x">
                  {edit?.id === m.id ? (
                    <textarea
                      className="mem-edit"
                      autoFocus
                      rows={2}
                      maxLength={500}
                      value={edit.text}
                      aria-label="Текст записи"
                      onChange={(e) => setEdit({ id: m.id, text: e.target.value })}
                      onBlur={saveEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          saveEdit()
                        } else if (e.key === 'Escape') {
                          e.stopPropagation()
                          setEdit(null)
                        }
                      }}
                    />
                  ) : (
                    <div className="mem-t" onDoubleClick={() => setEdit({ id: m.id, text: m.text })}>
                      {m.text}
                    </div>
                  )}
                  <div className="mem-m">
                    {m.by}
                    {m.chat && (
                      <>
                        {' '}
                        ·{' '}
                        <button className="linkbtn" onClick={() => goChat(m.chatId)}>
                          {m.chat}
                        </button>
                      </>
                    )}{' '}
                    · {ago(m.at)}
                  </div>
                </div>
                <button
                  className="iconbtn sm"
                  title="Изменить"
                  aria-label="Изменить запись"
                  onClick={() => setEdit({ id: m.id, text: m.text })}
                >
                  <Icon name="edit" size={13} />
                </button>
                <button
                  className="iconbtn sm"
                  title="Забыть"
                  aria-label="Забыть запись"
                  onClick={() => {
                    const keep = { ...m }
                    st().forget(m.id)
                    toast({
                      title: 'Запись удалена из памяти',
                      icon: 'trash',
                      action: { label: 'Вернуть', run: () => st().restoreMemory(keep) },
                    })
                  }}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            ))}
            {!mem.length && (
              <div className="cl-empty">
                {q
                  ? 'Ничего не нашлось.'
                  : 'Пока пусто. Решения из чатов попадают сюда автоматически — их видят все агенты проекта.'}
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}
