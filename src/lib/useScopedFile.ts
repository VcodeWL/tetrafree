import { useEffect, useMemo } from 'react'
import { useStore } from '../store'
import { download } from './util'
import { editorSession } from './editorSession'
import { freePath } from './trash'

/** Recovery stays in the original project's trash, without recreating a deleted file. */
export function useScopedFile(pid: string, path: string) {
  const session = useMemo(
    () =>
      editorSession({
        read: () => useStore.getState().projects.find((p) => p.id === pid)?.files[path],
        write: (text) => useStore.getState().writeFile(path, text, pid),
        recover: (text) => {
          let recovered = ''
          useStore.setState((s) => {
            const p = s.projects.find((p) => p.id === pid)
            if (!p) return
            const trash = p.trash || []
            recovered = freePath((name) => name in p.files || trash.some((t) => t.path === name), path)
            // Do not apply FILE_MAX or evict the original deleted copy: these are unsaved user edits.
            p.trash = [{ path: recovered, content: text, at: Date.now() }, ...trash]
          })
          useStore.getState().toast({
            title: recovered ? 'Правки сохранены в корзине' : 'Проект удалён — сохрани набранные правки',
            desc: recovered || path,
            tone: 'warn',
            icon: 'warn',
            action: {
              label: 'Скачать правки',
              run: () => download(path.split('/').pop() || 'правки.txt', text),
            },
          })
        },
      }),
    [pid, path],
  )
  useEffect(() => {
    session.observe()
    return useStore.subscribe(() => session.observe())
  }, [session])
  return session
}
