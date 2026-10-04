import { create } from 'zustand'
import { bGit, backendOnline, type GitStatus } from './backend'
import { resyncNow } from './sync'
import { useStore } from '../store'

interface GState {
  pid: string | null
  status: GitStatus | null
  loading: boolean
  error: string | null
  at: number
}
export const useGit = create<GState>(() => ({ pid: null, status: null, loading: false, error: null, at: 0 }))

let inflight: Promise<void> | null = null
/** Обновить статус git текущего проекта. Перед этим сбрасываем правки из приложения на диск. */
export function refreshGit(opts: { quiet?: boolean } = {}) {
  if (inflight) return inflight
  const p = useStore.getState().projects.find((x) => x.id === useStore.getState().projectId)
  if (!p || !backendOnline()) {
    useGit.setState({ pid: p?.id ?? null, status: null, loading: false, error: null })
    return Promise.resolve()
  }
  if (!opts.quiet) useGit.setState({ loading: true })
  inflight = (async () => {
    try {
      await resyncNow()
      const s = await bGit<GitStatus>('status', p)
      if (useStore.getState().projectId !== p.id) return
      if (!s.ok)
        useGit.setState({
          pid: p.id,
          status: null,
          error: s.reason || 'git недоступен',
          loading: false,
          at: Date.now(),
        })
      else
        useGit.setState({
          pid: p.id,
          status: { ...s, files: s.files.filter((f) => !(f.path === '.gitignore' && f.kind === 'new')) },
          error: null,
          loading: false,
          at: Date.now(),
        })
    } catch (e) {
      useGit.setState({ error: (e as Error).message, loading: false })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export { parseDiff, type DLine } from './unidiff'
