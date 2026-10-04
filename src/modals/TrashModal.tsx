import { useMemo, useState } from 'react'
import { useStore, useProject, toast } from '../store'
import { Modal, MHead } from '../components/ui/Modal'
import { Icon } from '../components/ui/Icon'
import { daysLeft, TRASH_DAYS } from '../lib/trash'
import { ago, plural } from '../lib/util'

/** Корзина: удалённые файлы проекта, 30 дней */
export function TrashModal() {
  const p = useProject()!
  const items = useMemo(() => [...(p.trash || [])].sort((a, b) => b.at - a.at), [p.trash])
  const [sel, setSel] = useState<string[]>([])
  const st = useStore.getState
  const toggle = (path: string) =>
    setSel((x) => (x.includes(path) ? x.filter((y) => y !== path) : [...x, path]))
  const restore = (paths: string[]) => {
    const out = st().restoreTrash(paths)
    setSel([])
    toast({
      title: out.length === 1 ? 'Файл возвращён' : `Возвращено файлов: ${out.length}`,
      desc: out.length === 1 ? out[0] : undefined,
      icon: 'check',
      tone: 'ok',
    })
  }
  return (
    <Modal label="Корзина" wide>
      <MHead
        icon="trash"
        title="Корзина"
        sub={`${p.name} · файлы хранятся ${TRASH_DAYS} дней, потом удаляются насовсем`}
      />
      <div className="td-body">
        {!items.length ? (
          <div className="muted" style={{ padding: '28px 4px', textAlign: 'center' }}>
            Корзина пуста. Удалённые файлы и папки появятся здесь.
          </div>
        ) : (
          <div className="trash-list">
            {items.map((it) => (
              <label key={it.path} className="td-row trash-row">
                <input
                  type="checkbox"
                  checked={sel.includes(it.path)}
                  onChange={() => toggle(it.path)}
                  aria-label={it.path}
                />
                <span className="td-t mono">{it.path}</span>
                <span className="td-tail">
                  {ago(it.at)} · ещё {daysLeft(it.at)} {plural(daysLeft(it.at), ['день', 'дня', 'дней'])}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
      {items.length > 0 && (
        <div
          className="mfoot"
          style={{ display: 'flex', gap: 8, justifyContent: 'space-between', padding: '12px 18px' }}
        >
          <button
            className="btn sm danger"
            onClick={() =>
              st().openModal({
                type: 'confirm',
                danger: true,
                confirm: 'Очистить',
                title: 'Очистить корзину?',
                body: `Файлов: ${items.length}. Вернуть их будет нельзя.`,
                run: () => {
                  st().dropTrash()
                  toast({ title: 'Корзина очищена', icon: 'trash' })
                },
              })
            }
          >
            <Icon name="trash" size={13} />
            Очистить
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn sm"
              disabled={!sel.length}
              onClick={() => {
                st().dropTrash(sel)
                setSel([])
              }}
            >
              Удалить навсегда
            </button>
            <button className="btn sm pri" disabled={!sel.length} onClick={() => restore(sel)}>
              Вернуть{sel.length ? ` (${sel.length})` : ''}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
