/* Внешние редакторы кода: список установленных (спрашиваем у сервера) и «открыть проект / файл на строке». */
import { create } from 'zustand'
import { useStore } from '../store'
import { backendOnline, bEditors, bOpenIn } from './backend'
import { reconcile, syncEnabled } from './sync'
import { currentCaret } from './team'

export interface EditorInfo {
  id: string
  name: string
}
export const useEditors = create<{ list: EditorInfo[]; loaded: boolean }>(() => ({ list: [], loaded: false }))

let inflight: Promise<EditorInfo[]> | null = null
/** обновить список (при открытии меню или настроек): редактор могли установить, пока приложение работало */
export function loadEditors(): Promise<EditorInfo[]> {
  if (!backendOnline()) {
    useEditors.setState({ list: [], loaded: true })
    return Promise.resolve([])
  }
  inflight ||= bEditors()
    .catch(() => [] as EditorInfo[])
    .then((list) => {
      useEditors.setState({ list, loaded: true })
      return list
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** редактор по умолчанию: выбранный в настройках, если он установлен, иначе первый найденный */
export const pickEditor = (list: EditorInfo[], pref?: string) => list.find((e) => e.id === pref) || list[0]

/** Открыть проект или файл. Перед этим дописываем на диск всё, что ещё не записано, чтобы редактор увидел свежее. */
export async function openInEditor(
  pid: string,
  opts: { file?: string; line?: number; editor?: string } = {},
) {
  const st = useStore.getState()
  const toast = st.toast
  const p = st.projects.find((x) => x.id === pid)
  if (!p) return false
  if (!backendOnline()) {
    toast({
      title: 'Нужен сервер TetraFree',
      desc: 'Открыть во внешнем редакторе можно, когда запущен встроенный сервер',
      icon: 'warn',
      tone: 'warn',
    })
    return false
  }
  const list = await loadEditors()
  const ed = opts.editor ? list.find((e) => e.id === opts.editor) : pickEditor(list, st.settings.editor)
  if (!ed) {
    toast({
      title: 'Редактор не найден',
      desc: 'Установи VS Code, Cursor, Zed или Sublime Text — TetraFree найдёт их сам',
      icon: 'warn',
      tone: 'warn',
    })
    return false
  }
  try {
    if (syncEnabled() && (await reconcile(pid, { quiet: true })) === null)
      await new Promise((r) => setTimeout(r, 450))
    const line =
      opts.line ?? (opts.file && currentCaret().file === opts.file ? currentCaret().line : undefined)
    const r = await bOpenIn(
      useStore.getState().projects.find((x) => x.id === pid) || p,
      ed.id,
      opts.file,
      line,
    )
    if (!r.ok) {
      toast({ title: 'Не открылось', desc: r.reason, icon: 'warn', tone: 'warn' })
      return false
    }
    toast({
      title: `Открыто в ${ed.name}`,
      desc: opts.file ? opts.file + (line ? ':' + line : '') : p.name,
      icon: 'code',
    })
    return true
  } catch (e) {
    toast({ title: 'Не открылось', desc: (e as Error).message, icon: 'warn', tone: 'warn' })
    return false
  }
}
