import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'

export type Anchor = DOMRect | { x: number; y: number }
type Place = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start'

/* Поповер-меню: портал, позиционирование в пределах экрана, клик вне и Esc закрывают */
export function Menu({
  anchor,
  onClose,
  place = 'bottom-start',
  className = '',
  children,
  width,
}: {
  anchor: Anchor
  onClose: () => void
  place?: Place
  className?: string
  children: ReactNode
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const restore = useRef(true)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth,
      h = el.offsetHeight,
      vw = window.innerWidth,
      vh = window.innerHeight
    let left: number, top: number
    if ('width' in anchor) {
      const r = anchor
      left = place.endsWith('end') ? r.right - w : place === 'right-start' ? r.right + 6 : r.left
      top = place.startsWith('top') ? r.top - h - 6 : place === 'right-start' ? r.top : r.bottom + 6
      if (top + h > vh - 8 && !place.startsWith('top')) top = Math.max(8, r.top - h - 6)
      if (top < 8) top = Math.min(vh - h - 8, r.bottom + 6)
    } else {
      left = anchor.x
      top = anchor.y
      if (top + h > vh - 8) top = anchor.y - h
    }
    left = Math.max(8, Math.min(left, vw - w - 8))
    top = Math.max(8, Math.min(top, vh - h - 8))
    setPos({ left, top })
  }, [anchor, place])

  useEffect(() => {
    const el = ref.current
    trigger.current = document.activeElement as HTMLElement | null
    restore.current = true
    const items = () =>
      Array.from(el?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') || [])
    const first = el?.querySelector<HTMLElement>('.ddi.sel:not([aria-disabled="true"])') || items()[0]
    const focusFrame = requestAnimationFrame(() => (first || el)?.focus({ preventScroll: true }))
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        restore.current = false
        onClose()
      }
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (!el?.contains(document.activeElement)) return
      const rows = items()
      const i = rows.indexOf(document.activeElement as HTMLElement)
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        const next =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? rows.length - 1
              : (i + (e.key === 'ArrowUp' ? -1 : 1) + rows.length) % rows.length
        rows[next]?.focus({ preventScroll: true })
      } else if (e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        restore.current = false
        const owner = trigger.current?.closest('[role="dialog"]') || document
        const candidates = Array.from(
          owner.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (node) =>
            !el.contains(node) &&
            node.tabIndex >= 0 &&
            node.getClientRects().length > 0 &&
            !node.closest('[inert]'),
        )
        const at = candidates.indexOf(trigger.current as HTMLElement)
        const next = candidates[at + (e.shiftKey ? -1 : 1)] || trigger.current
        onClose()
        next?.focus({ preventScroll: true })
      }
    }
    const t = setTimeout(() => document.addEventListener('pointerdown', down, true))
    document.addEventListener('keydown', key, true)
    window.addEventListener('resize', onClose)
    return () => {
      clearTimeout(t)
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key, true)
      window.removeEventListener('resize', onClose)
      if (
        restore.current &&
        trigger.current?.isConnected &&
        (el?.contains(document.activeElement) || document.activeElement === document.body)
      )
        trigger.current.focus({ preventScroll: true })
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      className={'dd ' + className}
      role="menu"
      tabIndex={-1}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

export function MenuItem({
  icon,
  label,
  right,
  onClick,
  danger,
  sel,
  disabled,
  children,
}: {
  icon?: IconName | ReactNode
  label?: ReactNode
  right?: ReactNode
  onClick?: () => void
  danger?: boolean
  sel?: boolean
  disabled?: boolean
  children?: ReactNode
}) {
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          if (!disabled) onClick?.()
        }
      }}
      className={'ddi' + (danger ? ' danger' : '') + (sel ? ' sel' : '') + (disabled ? ' dis' : '')}
      onClick={() => {
        if (!disabled) onClick?.()
      }}
    >
      {typeof icon === 'string' ? <Icon name={icon as IconName} size={15} /> : icon}
      {label !== undefined ? <span className="ddl">{label}</span> : null}
      {children}
      {right !== undefined && <span className="r">{right}</span>}
    </div>
  )
}
export const MenuHead = ({ children }: { children: ReactNode }) => <div className="ddh">{children}</div>
export const MenuSep = () => <div className="sep" />

/* Хук для меню: open(e) запоминает прямоугольник элемента */
export function useMenu<T = true>() {
  const [st, setSt] = useState<{ anchor: Anchor; data: T } | null>(null)
  return {
    st,
    open: (e: React.MouseEvent | DOMRect, data?: T) => {
      const anchor = 'currentTarget' in e ? (e.currentTarget as HTMLElement).getBoundingClientRect() : e
      setSt((cur) => (cur ? null : { anchor, data: (data ?? true) as T }))
    },
    at: (e: React.MouseEvent, data?: T) => {
      e.preventDefault()
      setSt({ anchor: { x: e.clientX, y: e.clientY }, data: (data ?? true) as T })
    },
    close: () => setSt(null),
  }
}
