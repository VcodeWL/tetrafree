/* Состояние автосохранения редактора для строки состояния: правки набраны (ждут записи) → записаны в проект. */
import { create } from 'zustand'
export const useEdit = create<{ pending: boolean; savedAt: number; file: string }>(() => ({
  pending: false,
  savedAt: 0,
  file: '',
}))
export const editPending = (file: string) => useEdit.setState({ pending: true, file })
export const editSaved = (file: string) => useEdit.setState({ pending: false, savedAt: Date.now(), file })
export const editIdle = () => useEdit.setState({ pending: false })
