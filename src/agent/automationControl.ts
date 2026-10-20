/* App-local controls. No background service: dispatch exists only in this application session. */
import { create } from 'zustand'

const KEY = 'tf-automation-control-v1'
function initial() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { paused: false, notifications: false, storageError: false }
    const v = JSON.parse(raw)
    if (v.version !== 1 || typeof v.paused !== 'boolean' || typeof v.notifications !== 'boolean')
      throw Error()
    return { paused: v.paused as boolean, notifications: v.notifications as boolean, storageError: false }
  } catch {
    return { paused: true, notifications: false, storageError: true }
  }
}
export const useAutomationControl = create(initial)
let generation = 0
const stoppers = new Set<() => void>()
export const automationEpoch = () => generation
export const automationAllowed = (epoch = generation) =>
  epoch === generation &&
  !useAutomationControl.getState().paused &&
  !useAutomationControl.getState().storageError
export const registerAutomationStopper = (stop: () => void) => {
  stoppers.add(stop)
  return () => {
    stoppers.delete(stop)
  }
}
function save(patch: Partial<{ paused: boolean; notifications: boolean }>) {
  const next = { ...useAutomationControl.getState(), ...patch }
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ version: 1, paused: next.paused, notifications: next.notifications }),
    )
    useAutomationControl.setState({ ...next, storageError: false })
  } catch {
    try {
      useAutomationControl.setState({ ...next, paused: true, storageError: true })
    } catch {
      /* Listener failure is not a cancellation barrier. */
    }
  }
}
/** Pause prevents new automatic dispatch; Stop additionally cancels all registered work. */
export function pauseAutomations() {
  generation++
  save({ paused: true })
}
export function resumeAutomations() {
  generation++
  save({ paused: false })
}
export function setAutomationNotifications(on: boolean) {
  save({ notifications: on })
}
export function stopEverything() {
  pauseAutomations()
  for (const stop of [...stoppers]) {
    try {
      stop()
    } catch {
      /* One failing listener must not prevent other cancellations. */
    }
  }
}
export type AutomationOutcome = 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'blocked'
export function notifyAutomation(outcome: AutomationOutcome) {
  if (
    !useAutomationControl.getState().notifications ||
    useAutomationControl.getState().storageError ||
    typeof window === 'undefined'
  )
    return
  const title =
    outcome === 'succeeded'
      ? 'Автоматизация завершена'
      : outcome === 'cancelled' || outcome === 'interrupted'
        ? 'Автоматизация остановлена'
        : 'Автоматизация не выполнена'
  try {
    window.dispatchEvent(new CustomEvent('tetrafree:automation-notification', { detail: { title, outcome } }))
  } catch {
    /* Optional notification delivery must not affect execution. */
  }
}
