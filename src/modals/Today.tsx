import { useMemo } from 'react'
import { useStore, useProject } from '../store'
import { Modal, MHead } from '../components/ui/Modal'
import { Icon } from '../components/ui/Icon'
import { ActorAv } from '../components/ui/primitives'
import { digest } from '../lib/today'
import { localDay, plural } from '../lib/util'
import { ME } from '../data/seed'
import type { Task } from '../types'

const WHY = { late: 'просрочено', today: 'срок сегодня', high: 'высокий приоритет' } as const

/** «Сегодня»: что ждёт тебя, что горит и что в работе — одним экраном */
export function TodayModal() {
  const p = useProject()!
  const st = useStore.getState
  const d = useMemo(() => digest(p, localDay(), ME), [p])
  const go = (fn: () => void) => {
    st().closeModal()
    setTimeout(fn, 0)
  }
  const task = (t: Task, tail?: string) => (
    <button
      key={t.id}
      className="td-row"
      onClick={() => go(() => st().openModal({ type: 'task', id: t.id }))}
    >
      <span className="tkey mono">T-{t.key}</span>
      <span className="td-t">{t.title}</span>
      {tail && <span className="td-tail">{tail}</span>}
      <ActorAv actor={t.assignee} size={20} />
    </button>
  )
  const empty =
    !d.needYou.length && !d.fire.length && !d.doing.length && !d.blocked.length && !d.running.length
  return (
    <Modal label="Сегодня" wide>
      <MHead
        icon="target"
        title="Сегодня"
        sub={`${p.name} · ${new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}`}
      />
      <div className="td-body">
        {empty && (
          <div className="td-empty">
            <Icon name="checksq" size={20} />
            <b>Всё спокойно</b>
            <p>Нет просрочек, ожидающих решений и задач в работе.</p>
          </div>
        )}
        {d.needYou.length > 0 && (
          <section>
            <h4>
              Ждёт тебя<span>{d.needYou.length}</span>
            </h4>
            {d.needYou.map((c) => (
              <button
                key={c.id}
                className="td-row"
                onClick={() => go(() => st().setCenter({ kind: 'chat', id: c.id }))}
              >
                <Icon name="chat" size={14} />
                <span className="td-t">{c.title}</span>
                <span className="td-tail warn">{c.why}</span>
              </button>
            ))}
          </section>
        )}
        {d.fire.length > 0 && (
          <section>
            <h4>
              Горит<span>{d.fire.length}</span>
            </h4>
            {d.fire.map((f) => task(f.task, WHY[f.why]))}
          </section>
        )}
        {d.running.length > 0 && (
          <section>
            <h4>
              Агенты работают<span>{d.running.length}</span>
            </h4>
            {d.running.map((c) => (
              <button
                key={c.id}
                className="td-row"
                onClick={() => go(() => st().setCenter({ kind: 'chat', id: c.id }))}
              >
                <Icon name="bolt" size={14} />
                <span className="td-t">{c.title}</span>
                <span className="td-tail">{c.why}</span>
              </button>
            ))}
          </section>
        )}
        {d.doing.length > 0 && (
          <section>
            <h4>
              В работе<span>{d.doing.length}</span>
            </h4>
            {d.doing.map((t) => task(t, t.status === 'review' ? 'ревью' : undefined))}
          </section>
        )}
        {d.blocked.length > 0 && (
          <section>
            <h4>
              Заблокировано<span>{d.blocked.length}</span>
            </h4>
            {d.blocked.map((b) => task(b.task, 'ждёт ' + b.by.map((x) => 'T-' + x.key).join(', ')))}
          </section>
        )}
      </div>
      <div className="mfoot">
        <span className="t4" style={{ fontSize: 12 }}>
          {plural(p.tasks.filter((t) => t.status !== 'done').length, [
            'открытая задача',
            'открытые задачи',
            'открытых задач',
          ])}
          : {p.tasks.filter((t) => t.status !== 'done').length}
        </span>
        <span className="grow" />
        <button className="btn gho" onClick={() => go(() => st().setCenter({ kind: 'tasks' }))}>
          Открыть доску
        </button>
      </div>
    </Modal>
  )
}
