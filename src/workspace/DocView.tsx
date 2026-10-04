import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { Block, BlockType, Doc } from '../types'
import { Icon, type IconName } from '../components/ui/Icon'
import { Inline, PersonAv } from '../components/ui/primitives'
import { Menu, MenuHead, MenuItem, MenuSep, useMenu } from '../components/ui/Menu'
import { ago, uid, download, slug, plural, copyText } from '../lib/util'
import { usePeers } from '../lib/team'
import { backlinks } from '../lib/backlinks'
import { MAX_INDENT, blockText, docMd, newTable } from '../lib/docmd'
import { isImageFile, shrinkImage } from '../lib/imgscale'

const TYPES: { t: BlockType; label: string; icon: IconName; hint: string }[] = [
  { t: 'p', label: 'Текст', icon: 'text', hint: 'обычный абзац' },
  { t: 'h2', label: 'Заголовок', icon: 'h2', hint: '## ' },
  { t: 'li', label: 'Маркер', icon: 'list', hint: '- ' },
  { t: 'todo', label: 'Задача', icon: 'checksq', hint: '[] ' },
  { t: 'code', label: 'Код', icon: 'code', hint: '``` ' },
  { t: 'quote', label: 'Цитата', icon: 'quote', hint: '> ' },
  { t: 'callout', label: 'Выноска', icon: 'info', hint: '! ' },
]
/** Блоки, которые не редактируются как текст в textarea */
const isText = (b: Block) => b.type !== 'table' && b.type !== 'image'

export function DocView({ doc }: { doc: Doc }) {
  const liveTeam = useStore((x) => {
    const p = x.projects.find((q) => q.id === x.projectId)
    return !!p?.cloud
  })
  const online = usePeers((x) => (x.by[useStore.getState().projectId || ''] || []).length > 0)
  const st = useStore.getState
  const [focus, setFocus] = useState<{ id: string; caret?: 'start' | 'end' } | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const slash = useMenu<string>()
  const bm = useMenu<string>()
  const toc = useMenu()
  const blocks = doc.blocks
  const save = (b: Block[]) => st().updateDoc(doc.id, { blocks: b })
  const patch = (id: string, p: Partial<Block>) => save(blocks.map((b) => (b.id === id ? { ...b, ...p } : b)))
  const insertAfter = (id: string, nb: Block) => {
    const i = blocks.findIndex((b) => b.id === id)
    const n = [...blocks]
    n.splice(i + 1, 0, nb)
    save(n)
    setFocus({ id: nb.id, caret: 'start' })
  }
  const remove = (id: string) => {
    const i = blocks.findIndex((b) => b.id === id)
    if (blocks.length === 1) {
      patch(id, { type: 'p', text: '' })
      return
    }
    save(blocks.filter((b) => b.id !== id))
    const prev = blocks[i - 1] || blocks[i + 1]
    if (prev) setFocus({ id: prev.id, caret: 'end' })
  }
  const fileIn = useRef<HTMLInputElement>(null)
  const pickFor = useRef<string | null>(null)
  /** свежие блоки: после await (сжатие картинки) замыкание `blocks` уже устарело */
  const fresh = () =>
    st()
      .projects.find((q) => q.id === st().projectId)
      ?.docs.find((d) => d.id === doc.id)?.blocks || []
  const addImages = async (files: File[], afterId: string | null, replaceId?: string) => {
    const imgs = files.filter(isImageFile)
    if (!imgs.length) return
    let at = afterId
    for (const f of imgs) {
      try {
        const src = await shrinkImage(f)
        const cur = fresh()
        const nb: Block = { id: uid('b'), type: 'image', text: '', src }
        const rep = replaceId && cur.find((x) => x.id === replaceId)
        if (rep) {
          st().updateDoc(doc.id, { blocks: cur.map((x) => (x.id === rep.id ? { ...nb, id: x.id } : x)) })
          replaceId = undefined
          at = rep.id
        } else {
          const i = at ? cur.findIndex((x) => x.id === at) : cur.length - 1
          const n = [...cur]
          n.splice(i + 1, 0, nb)
          st().updateDoc(doc.id, { blocks: n })
          at = nb.id
        }
      } catch (e) {
        st().toast({ title: 'Картинка не вставлена', desc: (e as Error).message, tone: 'err', icon: 'warn' })
      }
    }
  }
  const done = blocks.filter((b) => b.type === 'todo' && b.checked).length,
    todos = blocks.filter((b) => b.type === 'todo').length
  const links = useStoreWithEqualityFn(
    useStore,
    (x) => {
      const p = x.projects.find((q) => q.id === x.projectId)
      return p ? backlinks(doc, p.docs, p.tasks) : []
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )
  const words = blocks.reduce(
    (n, b) => n + (b.type === 'image' ? 0 : blockText(b).trim().split(/\s+/).filter(Boolean).length),
    0,
  )

  /* новый пустой документ: сразу в название, текст «Без названия» выделен — можно печатать */
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const d = useStore
      .getState()
      .projects.find((q) => q.id === useStore.getState().projectId)
      ?.docs.find((x) => x.id === doc.id)
    if (d && d.title === 'Без названия' && d.blocks.length === 1 && !blockText(d.blocks[0]).trim()) {
      titleRef.current?.focus()
      titleRef.current?.select()
    }
  }, [doc.id])

  return (
    <div className="doc">
      <div className="doc-in">
        <input
          ref={titleRef}
          className="dtitle"
          value={doc.title}
          placeholder="Без названия"
          onChange={(e) => st().updateDoc(doc.id, { title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'ArrowDown') {
              e.preventDefault()
              if (blocks[0]) setFocus({ id: blocks[0].id, caret: 'start' })
            }
          }}
          aria-label="Название документа"
        />
        <div className="dmeta">
          <PersonAv id={doc.createdBy} size={20} />
          <span>{useStore.getState().people[doc.createdBy]?.name}</span>
          <span className="vr" />
          <span>изменён {ago(doc.updatedAt)}</span>
          {words > 0 && (
            <>
              <span className="vr" />
              <span>
                {words} {plural(words, ['слово', 'слова', 'слов'])} · ~{Math.max(1, Math.round(words / 180))}{' '}
                мин
              </span>
            </>
          )}
          {todos > 0 && (
            <>
              <span className="vr" />
              <span>
                {done}/{todos} задач
              </span>
            </>
          )}
          {liveTeam && online && (
            <>
              <span className="vr" />
              <span className="live-co">
                <i />
                команда онлайн
              </span>
            </>
          )}
          <span className="grow" />
          {blocks.filter((b) => b.type === 'h2' && b.text.trim()).length >= 2 && (
            <button className="btn gho sm" onClick={(e) => toc.open(e)} aria-haspopup="menu">
              <Icon name="list" size={13} />
              Содержание
            </button>
          )}
          <button
            className="iconbtn sm"
            title="Копировать как Markdown"
            aria-label="Копировать как Markdown"
            onClick={() => {
              copyText(docMd(doc))
              st().toast({ title: 'Markdown скопирован', icon: 'copy' })
            }}
          >
            <Icon name="copy" size={14} />
          </button>
          <button
            className="iconbtn sm"
            title="Скачать .md"
            aria-label="Скачать .md"
            onClick={() => download(slug(doc.title) + '.md', docMd(doc), 'text/markdown')}
          >
            <Icon name="down" size={14} />
          </button>
        </div>
        <div className="blocks">
          {blocks.map((b) => (
            <div
              key={b.id}
              data-bid={b.id}
              className={
                'blkw' +
                (over === b.id && drag && drag !== b.id ? ' over' : '') +
                (drag === b.id ? ' dragging' : '')
              }
              onDragOver={(e) => {
                if (drag || e.dataTransfer.types.includes('Files')) {
                  e.preventDefault()
                  setOver(b.id)
                }
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (!drag && e.dataTransfer.files.length) {
                  void addImages([...e.dataTransfer.files], b.id)
                  setOver(null)
                  return
                }
                if (drag && drag !== b.id) {
                  const n = blocks.filter((x) => x.id !== drag)
                  const i = n.findIndex((x) => x.id === b.id)
                  n.splice(
                    i,
                    0,
                    blocks.find((x) => x.id === drag)!,
                  )
                  save(n)
                }
                setDrag(null)
                setOver(null)
              }}
            >
              <span
                className="handle"
                draggable
                onDragStart={(e) => {
                  setDrag(b.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', b.id)
                }}
                onDragEnd={() => {
                  setDrag(null)
                  setOver(null)
                }}
                onClick={(e) => bm.open(e, b.id)}
                title="Перетащи или нажми для меню"
              >
                <Icon name="grip" size={14} />
              </span>
              {b.type === 'table' ? (
                <TableEd
                  b={b}
                  focused={focus?.id === b.id}
                  onFocus={() => setFocus({ id: b.id })}
                  onChange={(p) => patch(b.id, p)}
                  onExit={(dir) => {
                    const i = blocks.findIndex((x) => x.id === b.id)
                    const t = blocks[i + dir]
                    if (t && isText(t)) setFocus({ id: t.id, caret: dir < 0 ? 'end' : 'start' })
                    else if (dir > 0) insertAfter(b.id, { id: uid('b'), type: 'p', text: '' })
                  }}
                />
              ) : b.type === 'image' ? (
                <ImageBlk b={b} onChange={(p) => patch(b.id, p)} />
              ) : (
                <BlockEd
                  b={b}
                  focused={focus?.id === b.id}
                  caret={focus?.id === b.id ? focus.caret : undefined}
                  onFocus={() => setFocus({ id: b.id })}
                  onBlur={() => setFocus((f) => (f?.id === b.id ? null : f))}
                  onChange={(p) => {
                    patch(b.id, p)
                    // смена типа пересоздаёт поле ввода: браузер шлёт blur и фокус теряется — возвращаем его
                    if (p.type && p.type !== b.type && focus?.id === b.id)
                      setTimeout(() => setFocus({ id: b.id, caret: 'end' }), 0)
                  }}
                  onEnter={(before, after) => {
                    const i = blocks.findIndex((x) => x.id === b.id)
                    const nb: Block =
                      b.type === 'li'
                        ? { id: uid('b'), type: 'li', text: after, indent: b.indent || 0 }
                        : { id: uid('b'), type: b.type === 'todo' ? 'todo' : 'p', text: after }
                    const n = [...blocks]
                    n[i] = { ...b, text: before }
                    n.splice(i + 1, 0, nb)
                    save(n)
                    setFocus({ id: nb.id, caret: 'start' })
                  }}
                  onBackspaceEmpty={() => (b.type !== 'p' ? patch(b.id, { type: 'p' }) : remove(b.id))}
                  onMergeUp={() => {
                    const i = blocks.findIndex((x) => x.id === b.id)
                    const prev = blocks[i - 1]
                    if (!prev || prev.type === 'code') return
                    const n = blocks
                      .filter((x) => x.id !== b.id)
                      .map((x) => (x.id === prev.id ? { ...x, text: x.text + b.text } : x))
                    save(n)
                    setFocus({ id: prev.id, caret: 'end' })
                  }}
                  onArrow={(dir) => {
                    let i = blocks.findIndex((x) => x.id === b.id) + dir
                    while (blocks[i] && !isText(blocks[i])) i += dir
                    const t = blocks[i]
                    if (t) setFocus({ id: t.id, caret: dir < 0 ? 'end' : 'start' })
                  }}
                  onPasteImage={(f) => void addImages(f, b.id, b.text ? undefined : b.id)}
                  onSlash={(el) => slash.open(el.getBoundingClientRect(), b.id)}
                />
              )}
            </div>
          ))}
          <div
            className="blk-add"
            role="button"
            onClick={() => {
              const last = blocks[blocks.length - 1]
              if (last && !last.text && last.type === 'p') setFocus({ id: last.id })
              else insertAfter(last?.id, { id: uid('b'), type: 'p', text: '' })
            }}
          >
            <Icon name="plus" size={14} />
            Нажми, чтобы добавить блок · «/» — выбрать тип
          </div>
        </div>
        {links.length > 0 && (
          <div className="backlinks">
            <div className="bl-h">Ссылаются сюда · {links.length}</div>
            {links.map((l) => (
              <button
                key={l.kind + l.id}
                className="bl-row"
                onClick={() =>
                  l.kind === 'doc'
                    ? st().setCenter({ kind: 'doc', id: l.id })
                    : st().openModal({ type: 'task', id: l.id })
                }
              >
                <Icon name={l.kind === 'doc' ? 'doc' : 'task'} size={13} />
                <span className="bl-t">{l.title}</span>
                <span className="bl-s">{l.snippet}</span>
              </button>
            ))}
            <div className="bl-hint">
              Чтобы ссылаться явно, напиши в тексте <code>[[Название документа]]</code>.
            </div>
          </div>
        )}
      </div>
      {toc.st && (
        <Menu anchor={toc.st.anchor} onClose={toc.close}>
          <MenuHead>Содержание</MenuHead>
          {blocks
            .filter((b) => b.type === 'h2' && b.text.trim())
            .map((b) => (
              <MenuItem
                key={b.id}
                icon="chev"
                label={b.text.trim().slice(0, 60)}
                onClick={() => {
                  toc.close()
                  document
                    .querySelector(`[data-bid="${b.id}"]`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
              />
            ))}
        </Menu>
      )}
      {slash.st && (
        <Menu anchor={slash.st.anchor} onClose={slash.close} width={240}>
          <MenuHead>Тип блока</MenuHead>
          {TYPES.map((t) => (
            <MenuItem
              key={t.t}
              icon={t.icon}
              label={t.label}
              right={t.hint}
              onClick={() => {
                patch(slash.st!.data, {
                  type: t.t,
                  text: blocks.find((x) => x.id === slash.st!.data)!.text.replace(/^\/\S*/, ''),
                })
                setFocus({ id: slash.st!.data, caret: 'end' })
                slash.close()
              }}
            />
          ))}
          <MenuSep />
          <MenuItem
            icon="grid"
            label="Таблица"
            right="3×3"
            onClick={() => {
              const id = slash.st!.data
              patch(id, { type: 'table', text: '', rows: newTable(3, 3) })
              setFocus({ id })
              slash.close()
            }}
          />
          <MenuItem
            icon="image"
            label="Картинка"
            right="файл или Ctrl+V"
            onClick={() => {
              pickFor.current = slash.st!.data
              const id = slash.st!.data
              patch(id, { text: blocks.find((x) => x.id === id)!.text.replace(/^\/\S*/, '') })
              slash.close()
              fileIn.current?.click()
            }}
          />
        </Menu>
      )}
      <input
        ref={fileIn}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        aria-label="Выбрать картинку"
        onChange={(e) => {
          const fs = [...(e.target.files || [])]
          e.target.value = ''
          const id = pickFor.current
          pickFor.current = null
          if (id) void addImages(fs, id, blocks.find((x) => x.id === id)?.text ? undefined : id)
        }}
      />
      {bm.st && (
        <Menu anchor={bm.st.anchor} onClose={bm.close} width={220}>
          {isText(blocks.find((x) => x.id === bm.st!.data) || blocks[0]) && <MenuHead>Превратить в</MenuHead>}
          {(isText(blocks.find((x) => x.id === bm.st!.data) || blocks[0]) ? TYPES : []).map((t) => (
            <MenuItem
              key={t.t}
              icon={t.icon}
              label={t.label}
              sel={blocks.find((x) => x.id === bm.st!.data)?.type === t.t}
              onClick={() => {
                patch(bm.st!.data, { type: t.t })
                bm.close()
              }}
            />
          ))}
          <MenuSep />
          <MenuItem
            icon="copy"
            label="Дублировать"
            onClick={() => {
              const b = blocks.find((x) => x.id === bm.st!.data)!
              insertAfter(b.id, { ...b, id: uid('b') })
              bm.close()
            }}
          />
          <MenuItem
            icon="trash"
            label="Удалить блок"
            danger
            onClick={() => {
              remove(bm.st!.data)
              bm.close()
            }}
          />
        </Menu>
      )}
    </div>
  )
}

function BlockEd({
  b,
  focused,
  caret,
  onFocus,
  onBlur,
  onChange,
  onEnter,
  onBackspaceEmpty,
  onMergeUp,
  onArrow,
  onSlash,
  onPasteImage,
}: {
  b: Block
  focused: boolean
  caret?: 'start' | 'end'
  onFocus: () => void
  onBlur: () => void
  onChange: (p: Partial<Block>) => void
  onEnter: (before: string, after: string) => void
  onBackspaceEmpty: () => void
  onMergeUp: () => void
  onArrow: (d: 1 | -1) => void
  onSlash: (el: HTMLElement) => void
  onPasteImage: (f: File[]) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const t = ref.current
    if (t) {
      t.style.height = '0'
      t.style.height = t.scrollHeight + 'px'
    }
  }, [b.text, focused, b.type])
  useEffect(() => {
    if (focused && ref.current && document.activeElement !== ref.current) {
      const t = ref.current
      t.focus()
      const pos = caret === 'start' ? 0 : t.value.length
      t.setSelectionRange(pos, pos)
    }
  }, [focused, caret])
  const shortcuts = (v: string) => {
    if (b.type === 'p') {
      const m: [RegExp, BlockType][] = [
        [/^## $/, 'h2'],
        [/^\[\] $/, 'todo'],
        [/^> $/, 'quote'],
        [/^``` $/, 'code'],
        [/^! $/, 'callout'],
        [/^- \[ \] $/, 'todo'],
        [/^[-*] $/, 'li'],
      ]
      for (const [re, t] of m)
        if (re.test(v)) {
          onChange({ type: t, text: '' })
          return true
        }
    }
    return false
  }
  const ta = (
    <textarea
      ref={ref}
      rows={1}
      value={b.text}
      spellCheck={b.type !== 'code'}
      placeholder={
        focused
          ? b.type === 'h2'
            ? 'Заголовок'
            : b.type === 'code'
              ? 'Код'
              : 'Текст или «/» для команд'
          : ''
      }
      aria-label="Блок документа"
      className={'bed t-' + b.type}
      onFocus={onFocus}
      onBlur={onBlur}
      onPaste={(e) => {
        const fs = [...e.clipboardData.files].filter(isImageFile)
        if (fs.length) {
          e.preventDefault()
          onPasteImage(fs)
        }
      }}
      onChange={(e) => {
        const v = e.target.value
        if (shortcuts(v)) return
        onChange({ text: v })
        if (v === '/') onSlash(e.target)
      }}
      onKeyDown={(e) => {
        const t = e.currentTarget
        const ind = b.indent || 0
        if (b.type === 'li' && e.key === 'Tab') {
          e.preventDefault()
          const n = Math.max(0, Math.min(MAX_INDENT, ind + (e.shiftKey ? -1 : 1)))
          if (n !== ind) onChange({ indent: n })
        } else if (b.type === 'li' && e.key === 'Enter' && !t.value && !e.nativeEvent.isComposing) {
          // пустой пункт: сначала поднимаем уровень, на верхнем — выходим из списка
          e.preventDefault()
          if (ind > 0) onChange({ indent: ind - 1 })
          else onChange({ type: 'p', indent: undefined })
        } else if (e.key === 'Enter' && !e.shiftKey && !(b.type === 'code') && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onEnter(t.value.slice(0, t.selectionStart), t.value.slice(t.selectionEnd))
        } else if (e.key === 'Enter' && b.type === 'code' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          onEnter(t.value, '')
        } else if (e.key === 'Backspace' && t.selectionStart === 0 && t.selectionEnd === 0) {
          if (!t.value) {
            e.preventDefault()
            onBackspaceEmpty()
          } else if (b.type === 'p') {
            e.preventDefault()
            onMergeUp()
          }
        } else if (e.key === 'ArrowUp' && t.selectionStart === 0) {
          e.preventDefault()
          onArrow(-1)
        } else if (e.key === 'ArrowDown' && t.selectionEnd === t.value.length) {
          e.preventDefault()
          onArrow(1)
        }
      }}
    />
  )
  const view =
    focused || !b.text ? (
      ta
    ) : (
      <div className={'bview t-' + b.type} onClick={onFocus} tabIndex={0} onFocus={onFocus}>
        {b.type === 'code' ? b.text : <Inline text={b.text} />}
      </div>
    )
  if (b.type === 'todo')
    return (
      <div className={'todoblk' + (b.checked ? ' done' : '')}>
        <span
          className={'cbx' + (b.checked ? ' done' : '')}
          role="checkbox"
          aria-checked={!!b.checked}
          aria-label={b.text.trim() ? b.text.trim().slice(0, 80) : 'Пункт списка дел'}
          tabIndex={0}
          onClick={() => onChange({ checked: !b.checked })}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault()
              onChange({ checked: !b.checked })
            }
          }}
        >
          {b.checked && <Icon name="check" size={13} stroke={2.6} style={{ color: '#0b0b10' }} />}
        </span>
        <span className="grow">{view}</span>
      </div>
    )
  if (b.type === 'callout')
    return (
      <div className="infoblk">
        <div className="infoblk-in">
          <span className="ii">
            <Icon name="info" size={16} />
          </span>
          <span className="grow">{view}</span>
        </div>
      </div>
    )
  if (b.type === 'li')
    return (
      <div className="liblk" style={{ paddingLeft: Math.min(b.indent || 0, MAX_INDENT) * 24 }}>
        <span className="libul" aria-hidden>
          {['•', '◦', '▪', '·'][Math.min(b.indent || 0, MAX_INDENT)]}
        </span>
        <span className="grow">{view}</span>
      </div>
    )
  if (b.type === 'code') return <div className="blk cb">{view}</div>
  if (b.type === 'quote') return <div className="blk quoteb">{view}</div>
  if (b.type === 'h2') return <div className="blk h2b">{view}</div>
  return <div className="blk">{view}</div>
}

function ImageBlk({ b, onChange }: { b: Block; onChange: (p: Partial<Block>) => void }) {
  return (
    <figure className="imgblk">
      <img src={b.src} alt={b.text || 'Картинка в документе'} draggable={false} />
      <input
        className="imgcap"
        value={b.text}
        placeholder="Подпись"
        aria-label="Подпись к картинке"
        onChange={(e) => onChange({ text: e.target.value })}
      />
    </figure>
  )
}

function Cell({
  v,
  head,
  r,
  c,
  onChange,
  onKeyDown,
  onFocus,
}: {
  v: string
  head: boolean
  r: number
  c: number
  onChange: (v: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onFocus: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const t = ref.current
    if (t) {
      t.style.height = '0'
      t.style.height = t.scrollHeight + 'px'
    }
  }, [v])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={v}
      data-r={r}
      data-c={c}
      className={'tcell' + (head ? ' head' : '')}
      aria-label={(head ? 'Заголовок столбца ' : 'Ячейка ') + (c + 1) + (head ? '' : ', строка ' + (r + 1))}
      onFocus={onFocus}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={onKeyDown}
    />
  )
}

function TableEd({
  b,
  focused,
  onFocus,
  onChange,
  onExit,
}: {
  b: Block
  focused: boolean
  onFocus: () => void
  onChange: (p: Partial<Block>) => void
  onExit: (dir: 1 | -1) => void
}) {
  const rows = b.rows && b.rows.length ? b.rows : newTable(2, 2)
  const cols = Math.max(...rows.map((r) => r.length), 1)
  const grid = rows.map((r) => Array.from({ length: cols }, (_, k) => r[k] || ''))
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<[number, number]>([0, 0])
  const [r0, c0] = [Math.min(at[0], grid.length - 1), Math.min(at[1], cols - 1)]
  useEffect(() => {
    if (focused && !ref.current?.contains(document.activeElement))
      ref.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }, [focused])
  const go = (r: number, c: number) => {
    const find = () => ref.current?.querySelector<HTMLTextAreaElement>(`[data-r="${r}"][data-c="${c}"]`)
    const el = find()
    if (el)
      el.focus() // ячейка уже есть — сразу, чтобы быстрый набор не уходил в старую
    else requestAnimationFrame(() => find()?.focus()) // новая строка/столбец появится после рендера
  }
  const put = (g: string[][]) => onChange({ rows: g })
  const set = (r: number, c: number, v: string) =>
    put(grid.map((row, i) => (i === r ? row.map((x, k) => (k === c ? v : x)) : row)))
  const addRow = (after: number) => {
    const g = [...grid]
    g.splice(after + 1, 0, Array(cols).fill(''))
    put(g)
    return after + 1
  }
  const addCol = (after: number) => {
    put(grid.map((row) => [...row.slice(0, after + 1), '', ...row.slice(after + 1)]))
    go(r0, after + 1)
  }
  const key = (r: number, c: number) => (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    const t = e.currentTarget
    if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) {
        if (c > 0) go(r, c - 1)
        else if (r > 0) go(r - 1, cols - 1)
        else onExit(-1)
      } else if (c < cols - 1) go(r, c + 1)
      else if (r < grid.length - 1) go(r + 1, 0)
      else go(addRow(r), 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (r < grid.length - 1) go(r + 1, c)
      else go(addRow(r), c)
    } else if (e.key === 'ArrowDown' && t.selectionEnd === t.value.length) {
      e.preventDefault()
      if (r < grid.length - 1) go(r + 1, c)
      else onExit(1)
    } else if (e.key === 'ArrowUp' && t.selectionStart === 0) {
      e.preventDefault()
      if (r > 0) go(r - 1, c)
      else onExit(-1)
    } else if (e.key === 'ArrowRight' && t.selectionEnd === t.value.length && c < cols - 1) {
      e.preventDefault()
      go(r, c + 1)
    } else if (e.key === 'ArrowLeft' && t.selectionStart === 0 && c > 0) {
      e.preventDefault()
      go(r, c - 1)
    }
  }
  return (
    <div className="tblblk" ref={ref} role="group" aria-label="Таблица">
      <div className="tbl-scroll">
        <div className="tbl" style={{ gridTemplateColumns: `repeat(${cols}, minmax(110px, 1fr))` }}>
          {grid.map((row, r) =>
            row.map((v, c) => (
              <Cell
                key={r + ':' + c}
                v={v}
                head={r === 0}
                r={r}
                c={c}
                onFocus={() => {
                  setAt([r, c])
                  onFocus()
                }}
                onChange={(x) => set(r, c, x)}
                onKeyDown={key(r, c)}
              />
            )),
          )}
        </div>
      </div>
      <div className="tbl-bar">
        <button className="btn gho sm" onClick={() => go(addRow(r0), c0)}>
          <Icon name="plus" size={12} />
          Строка
        </button>
        <button className="btn gho sm" onClick={() => addCol(c0)}>
          <Icon name="plus" size={12} />
          Столбец
        </button>
        <button
          className="btn gho sm"
          disabled={grid.length < 2}
          onClick={() => {
            const rr = Math.max(0, r0 === 0 ? 0 : r0)
            put(grid.filter((_, i) => i !== rr))
            go(Math.min(rr, grid.length - 2), c0)
          }}
        >
          <Icon name="minus" size={12} />
          Строка {r0 + 1}
        </button>
        <button
          className="btn gho sm"
          disabled={cols < 2}
          onClick={() => {
            put(grid.map((row) => row.filter((_, k) => k !== c0)))
            go(r0, Math.min(c0, cols - 2))
          }}
        >
          <Icon name="minus" size={12} />
          Столбец {c0 + 1}
        </button>
      </div>
    </div>
  )
}
