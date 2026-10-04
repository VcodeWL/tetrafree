/* Вкладки терминала: у каждого проекта свой список. Вкладка = отдельный сеанс shell на сервере. */
import { create } from 'zustand'

export interface TermTab {
  id: string
  n: number // порядковый номер для названия «Терминал N»
}
export interface TabsState {
  tabs: TermTab[]
  active: string
  seq: number
}
export const MAX_TABS = 6
export const initialTabs = (): TabsState => ({ tabs: [{ id: 't1', n: 1 }], active: 't1', seq: 1 })

export function addTab(s: TabsState): TabsState {
  if (s.tabs.length >= MAX_TABS) return s
  const seq = s.seq + 1
  const t = { id: 't' + seq, n: seq }
  return { tabs: [...s.tabs, t], active: t.id, seq }
}
/** Закрывает вкладку; активной становится соседняя. Последнюю не закрываем — вернётся null */
export function closeTab(s: TabsState, id: string): TabsState | null {
  const i = s.tabs.findIndex((t) => t.id === id)
  if (i < 0) return s
  if (s.tabs.length === 1) return null
  const tabs = s.tabs.filter((t) => t.id !== id)
  const active = s.active === id ? tabs[Math.min(i, tabs.length - 1)].id : s.active
  return { ...s, tabs, active }
}
export const pickTab = (s: TabsState, id: string): TabsState =>
  s.tabs.some((t) => t.id === id) ? { ...s, active: id } : s
/** Ключ сеанса: у первой вкладки он равен id проекта (так остаются живыми сеансы, открытые до обновления) */
export const sessionKey = (pid: string, tabId: string) => (tabId === 't1' ? pid : pid + '#' + tabId)

/** Проверка данных из localStorage: битое → начальное состояние */
export function sanitize(raw: unknown): TabsState {
  const r = raw as Partial<TabsState> | null
  if (!r || !Array.isArray(r.tabs) || !r.tabs.length) return initialTabs()
  const tabs = r.tabs
    .filter(
      (t): t is TermTab => !!t && typeof t.id === 'string' && /^t\d+$/.test(t.id) && Number.isInteger(t.n),
    )
    .slice(0, MAX_TABS)
  if (!tabs.length) return initialTabs()
  const seq = Math.max(+(r.seq ?? 0) || 0, ...tabs.map((t) => t.n))
  return { tabs, active: tabs.some((t) => t.id === r.active) ? (r.active as string) : tabs[0].id, seq }
}

const KEY = 'tf.termtabs'
const load = (): Record<string, TabsState> => {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, sanitize(v)]))
  } catch {
    return {}
  }
}
export const useTermTabs = create<{ by: Record<string, TabsState> }>(() => ({ by: load() }))
export const tabsOf = (by: Record<string, TabsState>, pid: string) => by[pid] ?? initialTabs()
export function updateTabs(pid: string, fn: (s: TabsState) => TabsState | null) {
  useTermTabs.setState((st) => {
    const cur = tabsOf(st.by, pid)
    const next = fn(cur)
    const by = { ...st.by }
    if (next) by[pid] = next
    else delete by[pid]
    try {
      localStorage.setItem(KEY, JSON.stringify(by))
    } catch {
      /* переполнено — не страшно */
    }
    return { by }
  })
}
