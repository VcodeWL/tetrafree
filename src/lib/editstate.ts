/* Editor-memory observation only. Not a durability or disk certificate. */
import { create } from 'zustand'
export const useEdit = create<{ pending: boolean; savedAt: number; file: string; pid: string | null }>(
  () => ({
    pending: false,
    savedAt: 0,
    file: '',
    pid: null,
  }),
)
export const editPending = (file: string, pid: string) =>
  useEdit.setState({ pending: true, savedAt: 0, file, pid })
export const editSaved = (file: string, pid: string) =>
  useEdit.setState({ pending: false, savedAt: Date.now(), file, pid })
export const editIdle = (pid?: string) => {
  if (pid && useEdit.getState().pid !== pid) return
  useEdit.setState({ pending: false, savedAt: 0, file: '', pid: null })
}
