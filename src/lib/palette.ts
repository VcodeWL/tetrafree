/* Keep requests alive while the heavy command palette chunk is loading. */
import { useStore } from '../store'
let prefix = ''
export const palettePrefix = () => prefix
export function startPaletteBridge() {
  const on = (event: Event) => {
    const detail = (event as CustomEvent).detail
    prefix = typeof detail === 'string' ? detail.slice(0, 2000) : ''
    useStore.getState().setPalette(true)
  }
  window.addEventListener('tf:palette', on)
  return () => window.removeEventListener('tf:palette', on)
}
export function openPalette(value = '') {
  prefix = value.slice(0, 2000)
  useStore.getState().setPalette(true)
  window.dispatchEvent(new CustomEvent('tf:palette', { detail: prefix }))
}
