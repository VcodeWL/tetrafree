import { useUnseenRelease } from '../lib/whatsnew'
import { Resizer } from '../components/ui/Resizer'
import { useLayout, SIDE } from '../lib/layout'
import { useStore, useProject, getProject } from '../store'
import { stopTurn } from '../agent/engine'
import { Avatar, AgentAvatar, PersonAv, Working } from '../components/ui/primitives'
import { DOC_TEMPLATES, buildBlocks } from '../data/docTemplates'
import { exportChat } from '../lib/chatExport'
import { Icon } from '../components/ui/Icon'
import { Menu, MenuHead, MenuItem, MenuSep, useMenu } from '../components/ui/Menu'
import { ago, modKey, localDay } from '../lib/util'
import { digest } from '../lib/today'
import { ME } from '../data/seed'
import { useMemo } from 'react'
import type { Chat, Doc } from '../types'

const snippet = (c: Chat) => {
  for (let i = c.messages.length - 1; i >= 0; i--) {
    const m = c.messages[i]
    if (m.kind === 'agent' || m.kind === 'human')
      return (
        (m.kind === 'agent' ? m.agent + ': ' : '') +
        m.text
          .replace(/```[\s\S]*?```/g, '[код]')
          .replace(/[*`_#>]/g, '')
          .slice(0, 80)
      )
  }
  return 'пустой чат'
}

export function Sidebar() {
  const p = useProject()!
  const center = useStore((s) => s.center)
  const mode = useStore((s) => s.mode)
  const me = useStore((s) => s.people.me)
  const unseen = useUnseenRelease()
  const people = useStore((s) => s.people)
  const showOnline = useStore((s) => s.settings.showOnline)
  const st = useStore.getState
  const cm = useMenu<Chat>()
  const dm = useMenu<Doc>()
  const tm = useMenu()
  const open = p.tasks.filter((t) => t.status !== 'done').length
  const dg = useMemo(() => digest(p, localDay(), ME), [p])
  const hot = dg.needYou.length + dg.fire.length
  const pending = (c: Chat) => {
    const a = [...c.messages].reverse().find((m) => m.kind === 'agent')
    return !!a && a.kind === 'agent' && (a.turn?.state === 'proposed' || a.turn?.state === 'partial')
  }
  return (
    <aside className="side" aria-label="Боковая панель">
      <SideResizer />
      <div className="side-proj">
        <div
          className="pj-row"
          role="button"
          tabIndex={0}
          onClick={() => st().toLauncher()}
          title={`К списку проектов (${modKey}+O)${p.path ? '\n' + p.path : ''}`}
        >
          <span className="pj-ico">
            <Icon name={p.icon} size={17} />
          </span>
          <div className="pj-txt">
            <div className="pn">{p.name}</div>
            <div className="pby">создатель · {people[p.creator]?.name}</div>
          </div>
          <span className="chev">
            <Icon name="chevl" size={15} />
          </span>
        </div>
        <div className="pj-meta">
          <div className="avstack">
            {p.members.slice(0, 5).map((m) => (
              <PersonAv key={m} id={m} size={23} />
            ))}
          </div>
          <span className="more">
            {p.members.length > 5 ? '+' + (p.members.length - 5) : ''} все видят все чаты
          </span>
          <button
            className="iconbtn sm"
            onClick={() => st().openModal({ type: 'settings', section: 'members' })}
            title="Пригласить"
          >
            <Icon name="userplus" size={14} />
          </button>
        </div>
      </div>
      <div className="modeseg" role="tablist">
        <span className="mthumb" style={{ transform: mode === 'design' ? 'translateX(100%)' : 'none' }} />
        <button
          role="tab"
          aria-selected={mode === 'dev'}
          className={mode === 'dev' ? 'on' : ''}
          onClick={() => st().setMode('dev')}
        >
          <Icon name="code" size={13} />
          Разработка
        </button>
        <button
          role="tab"
          aria-selected={mode === 'design'}
          className={mode === 'design' ? 'on' : ''}
          onClick={() => st().setMode('design')}
        >
          <Icon name="paint" size={13} />
          Дизайн
        </button>
      </div>
      <div className="side-scroll">
        <div className="sg-head">
          Чаты
          <span
            className="add"
            role="button"
            title={`Новый чат (${modKey}+Shift+A)`}
            onClick={() => st().openModal({ type: 'newChat' })}
          >
            <Icon name="plus" size={14} />
          </span>
        </div>
        {[...p.chats]
          .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
          .map((c) => (
            <div
              key={c.id}
              className={'li' + (center.kind === 'chat' && center.id === c.id ? ' on' : '')}
              role="button"
              tabIndex={0}
              onClick={() => st().setCenter({ kind: 'chat', id: c.id })}
              onContextMenu={(e) => cm.at(e, c)}
              onKeyDown={(e) => e.key === 'Enter' && st().setCenter({ kind: 'chat', id: c.id })}
            >
              <span className="ico">
                {c.creator.kind === 'agent' ? (
                  <AgentAvatar name={c.creator.name} size={18} />
                ) : (
                  <Icon name="chat" size={16} />
                )}
              </span>
              <div className="lt">
                <div className="n">
                  <span className="nt">{c.title}</span>
                  {c.pinned && <Icon name="pin" size={11} className="pinned-ic" />}
                  {c.running && <Working />}
                </div>
                <div className="s">{snippet(c)}</div>
              </div>
              {pending(c) ? (
                <span className="ldot warn" title="Ждёт разрешения" />
              ) : c.unread ? (
                <span className="ldot" title="Новые сообщения" />
              ) : (
                <span className="lwhen">{ago(c.lastAt).replace(' назад', '')}</span>
              )}
            </div>
          ))}
        {!p.chats.length && (
          <div className="empty-li">Чатов пока нет. Начни с запроса на главном экране или нажми «+».</div>
        )}
        <div className="sg-head">
          Документы
          <span className="add" role="button" title="Новый документ" onClick={tm.open}>
            <Icon name="plus" size={14} />
          </span>
        </div>
        {p.docs.map((d) => (
          <div
            key={d.id}
            className={'li' + (center.kind === 'doc' && center.id === d.id ? ' on' : '')}
            role="button"
            tabIndex={0}
            onClick={() => st().setCenter({ kind: 'doc', id: d.id })}
            onContextMenu={(e) => dm.at(e, d)}
          >
            <span className="ico">
              <Icon name="doc" size={16} />
            </span>
            <div className="lt">
              <div className="n">
                <span className="nt">{d.title || 'Без названия'}</span>
              </div>
              <div className="s">
                {people[d.createdBy]?.name} · {ago(d.updatedAt)}
              </div>
            </div>
          </div>
        ))}
        {!p.docs.length && (
          <div className="empty-li">
            Заметки команды хранятся в проекте. Любой документ можно скачать как .md.
          </div>
        )}
        <div className="sg-head">Планирование</div>
        <div
          className="li"
          role="button"
          tabIndex={0}
          onClick={() => st().openModal({ type: 'today' })}
          onKeyDown={(e) => e.key === 'Enter' && st().openModal({ type: 'today' })}
          title={`Сегодня (${modKey}+Shift+Y)`}
        >
          <span className="ico">
            <Icon name="target" size={16} />
          </span>
          <div className="lt">
            <div className="n">Сегодня</div>
            <div className="s">{hot ? `${hot} требуют внимания` : 'всё спокойно'}</div>
          </div>
          {hot > 0 && <span className="count">{hot}</span>}
        </div>
        <div
          className={'li' + (center.kind === 'tasks' ? ' on' : '')}
          role="button"
          tabIndex={0}
          onClick={() => st().setCenter({ kind: 'tasks' })}
        >
          <span className="ico">
            <Icon name="task" size={16} />
          </span>
          <div className="lt">
            <div className="n">Задачи</div>
            <div className="s">
              {open} открыто · {p.tasks.length - open} готово
            </div>
          </div>
          {open > 0 && <span className="count">{open}</span>}
        </div>
      </div>
      <div className="side-foot">
        <div
          className="pf"
          role="button"
          tabIndex={0}
          onClick={() => st().openModal({ type: 'settings' })}
          title={`Настройки (${modKey}+,)`}
        >
          <Avatar person={me} size={36} />
          <div className="who">
            <span className="n">{me.name}</span>
            <span className="st">
              {showOnline ? (
                <>
                  <i className={'g ' + (me.status || 'online')} />
                  {me.status === 'away' ? 'отошёл' : 'в сети'}
                </>
              ) : (
                'статус скрыт'
              )}
              {me.role ? ' · ' + me.role : ''}
            </span>
          </div>
          <span className="gear" title={unseen ? 'Есть обновление: что нового' : undefined}>
            <Icon name="gear" size={16} />
            {unseen && <i className="newdot" />}
          </span>
        </div>
      </div>
      {cm.st && (
        <Menu anchor={cm.st.anchor} onClose={cm.close}>
          <MenuItem
            icon="edit"
            label="Переименовать"
            onClick={() => {
              const c = cm.st!.data
              cm.close()
              st().openModal({
                type: 'rename',
                title: 'Переименовать чат',
                value: c.title,
                run: (v) => st().renameChat(c.id, v),
              })
            }}
          />
          <MenuItem
            icon="pin"
            label={cm.st.data.pinned ? 'Открепить' : 'Закрепить вверху'}
            onClick={() => {
              const c = cm.st!.data
              st().setChat(c.id, { pinned: !c.pinned })
              cm.close()
            }}
          />
          <MenuItem
            icon="copy"
            label="Дублировать"
            onClick={() => {
              const c = cm.st!.data
              cm.close()
              if (st().duplicateChat(c.id))
                st().toast({ title: 'Чат продублирован', desc: c.title, icon: 'chat' })
            }}
          />
          <MenuItem
            icon="down"
            label="Экспорт в Markdown"
            onClick={() => {
              exportChat(cm.st!.data)
              cm.close()
            }}
          />
          <MenuItem
            icon="check"
            label="Отметить прочитанным"
            onClick={() => {
              st().setChat(cm.st!.data.id, { unread: false })
              cm.close()
            }}
          />
          <MenuSep />
          <MenuItem
            icon="trash"
            label="Удалить чат"
            danger
            onClick={() => {
              const c = cm.st!.data
              cm.close()
              st().openModal({
                type: 'confirm',
                danger: true,
                title: `Удалить чат «${c.title}»?`,
                body: 'Переписка исчезнет у всех участников. Решения агентов останутся в общей памяти проекта.',
                confirm: 'Удалить',
                run: () => {
                  stopTurn(c.id)
                  const p = getProject()!
                  const i = p.chats.findIndex((x) => x.id === c.id)
                  const copy = structuredClone(p.chats[i])
                  st().deleteChat(c.id)
                  st().toast({
                    title: 'Чат удалён',
                    desc: c.title,
                    icon: 'trash',
                    action: { label: 'Вернуть', run: () => st().restoreChat(copy, i) },
                  })
                },
              })
            }}
          />
        </Menu>
      )}
      {tm.st && (
        <Menu anchor={tm.st.anchor} onClose={tm.close}>
          <MenuItem
            icon="doc"
            label="Пустой документ"
            onClick={() => {
              tm.close()
              st().createDoc()
            }}
          />
          <MenuSep />
          <MenuHead>Из шаблона</MenuHead>
          {DOC_TEMPLATES.map((t) => (
            <MenuItem
              key={t.k}
              icon="doc"
              label={t.title}
              right={t.hint}
              onClick={() => {
                tm.close()
                const id = st().createDoc()
                st().updateDoc(id, { title: t.title, blocks: buildBlocks(t.k) })
              }}
            />
          ))}
        </Menu>
      )}
      {dm.st && (
        <Menu anchor={dm.st.anchor} onClose={dm.close}>
          <MenuItem
            icon="edit"
            label="Переименовать"
            onClick={() => {
              const d = dm.st!.data
              dm.close()
              st().openModal({
                type: 'rename',
                title: 'Переименовать документ',
                value: d.title,
                run: (v) => st().updateDoc(d.id, { title: v }),
              })
            }}
          />
          <MenuSep />
          <MenuItem
            icon="trash"
            label="Удалить документ"
            danger
            onClick={() => {
              const d = dm.st!.data
              dm.close()
              st().openModal({
                type: 'confirm',
                danger: true,
                title: `Удалить «${d.title}»?`,
                body: 'Документ будет удалён у всех участников.',
                confirm: 'Удалить',
                run: () => st().deleteDoc(d.id),
              })
            }}
          />
        </Menu>
      )}
    </aside>
  )
}

function SideResizer() {
  const w = useLayout((l) => l.sideW)
  return (
    <Resizer
      axis="x"
      className="side-rsz"
      label="Ширина боковой панели"
      value={w}
      min={SIDE.min}
      max={SIDE.max}
      onChange={useLayout.getState().setSide}
      onReset={() => useLayout.getState().setSide(SIDE.def)}
    />
  )
}
