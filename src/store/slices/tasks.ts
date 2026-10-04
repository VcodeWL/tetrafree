import { upsert as upsertView } from '../../lib/taskviews'
import type { Task } from '../../types'
import { uid, localDay } from '../../lib/util'
import { current } from 'immer'
import { spawnNext, openBlockers } from '../../lib/taskrel'
import { tomb, find } from '../helpers'
import type { SetState, GetState, Actions } from '../types'

export const tasksActions = (
  set: SetState,
  get: GetState,
): Pick<
  Actions,
  'saveTask' | 'moveTask' | 'deleteTask' | 'setTaskView' | 'saveTaskView' | 'removeTaskView' | 'setLanes'
> => ({
  saveTask: (t) => {
    let id = t.id || ''
    let again = null as Partial<Task> | null
    set((s) => {
      const p = find(s)
      if (!p) return
      const ex = t.id ? p.tasks.find((x) => x.id === t.id) : undefined
      if (ex) {
        if (t.status === 'done' && ex.status !== 'done')
          again = spawnNext({ ...current(ex), ...t } as Task, localDay())
        Object.assign(ex, t, { updatedAt: Date.now() })
        return
      }
      id = 't' + uid()
      p.tasks.push({
        key: p.taskSeq++,
        desc: '',
        status: 'backlog',
        assignee: null,
        priority: 'med',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...t,
        id,
      } as Task)
    })
    if (again) {
      const nid = get().saveTask(again as Task)
      const k = get()
        .projects.find((x) => x.id === get().projectId)
        ?.tasks.find((x) => x.id === nid)?.key
      get().toast({
        title: 'Создан повтор',
        desc: `${(again as Partial<Task>).title} · T-${k}`,
        icon: 'refresh',
      })
    }
    return id
  },
  moveTask: (id, status, beforeId) => {
    let again = null as Partial<Task> | null
    let blocked = [] as string[]
    set((s) => {
      const p = find(s)
      if (!p) return
      const i = p.tasks.findIndex((t) => t.id === id)
      if (i < 0) return
      const [t] = p.tasks.splice(i, 1)
      if (status === 'done' && t.status !== 'done') again = spawnNext(current(t), localDay())
      if (status === 'doing' && t.status !== 'doing' && t.status !== 'done')
        blocked = openBlockers(
          current(t),
          p.tasks.map((x) => current(x)),
        ).map((x) => 'T-' + x.key)
      t.status = status
      t.updatedAt = Date.now()
      const j = beforeId ? p.tasks.findIndex((x) => x.id === beforeId) : -1
      if (j >= 0) p.tasks.splice(j, 0, t)
      else p.tasks.push(t)
    })
    if (again) {
      const nid = get().saveTask(again as Task)
      const k = get()
        .projects.find((x) => x.id === get().projectId)
        ?.tasks.find((x) => x.id === nid)?.key
      get().toast({
        title: 'Создан повтор',
        desc: `${(again as Partial<Task>).title} · T-${k}${(again as Partial<Task>).due ? ' · срок ' + (again as Partial<Task>).due : ''}`,
        icon: 'refresh',
      })
    }
    if (blocked.length)
      get().toast({
        title: 'Задача ещё заблокирована',
        desc: 'Не готово: ' + blocked.join(', '),
        icon: 'warn',
        tone: 'warn',
      })
  },
  deleteTask: (id) =>
    set((s) => {
      const p = find(s)
      if (p) {
        p.tasks = p.tasks.filter((t) => t.id !== id)
        tomb(p, id)
      }
    }),
  setTaskView: (v) =>
    set((s) => {
      s.taskView = v
    }),

  saveTaskView: (name, f) =>
    set((s) => {
      const p = find(s)
      if (p) p.taskViews = upsertView(p.taskViews || [], name, f, uid('tv'))
    }),
  removeTaskView: (id) =>
    set((s) => {
      const p = find(s)
      if (p?.taskViews) p.taskViews = p.taskViews.filter((v) => v.id !== id)
    }),
  setLanes: (fn, pid) =>
    set((s) => {
      const p = find(s, pid)
      if (p) p.lanes = fn(p.lanes)
    }),
})
