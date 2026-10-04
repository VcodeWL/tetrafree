import { useEffect, useRef, type ReactNode } from 'react'
import { useModalFocus } from '../../hooks/useFocus'
import { useStore } from '../../store'
import { Icon, type IconName } from './Icon'

/* Общая оболочка модалки. Esc и клик по подложке закрывают (если не busy). */
export function Modal({
  children,
  wide,
  kind = 'card',
  onClose,
  busy,
  label,
}: {
  children: ReactNode
  wide?: boolean
  kind?: 'card' | 'settings' | 'bare'
  onClose?: () => void
  busy?: boolean
  label?: string
}) {
  const close = useStore((s) => s.closeModal)
  const doClose = onClose || close
  const wrap = useRef<HTMLDivElement>(null)
  useModalFocus(wrap)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return
      /* Esc закрывает только верхний слой: сначала меню и палитру, потом модалку */
      if (document.querySelector('.dd') || useStore.getState().palette || e.defaultPrevented) return
      e.preventDefault()
      doClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [doClose, busy])
  return (
    <div
      ref={wrap}
      className="modal-wrap open"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) doClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {kind === 'settings' ? (
        children
      ) : kind === 'bare' ? (
        children
      ) : (
        <div className={'mcard' + (wide ? ' wide' : '')}>
          <div className="mcard-in">{children}</div>
        </div>
      )}
    </div>
  )
}
export function MHead({
  icon,
  title,
  sub,
  onClose,
}: {
  icon: IconName
  title: ReactNode
  sub?: ReactNode
  onClose?: () => void
}) {
  const close = useStore((s) => s.closeModal)
  return (
    <>
      <button className="iconbtn mclose" onClick={onClose || close} aria-label="Закрыть">
        <Icon name="x" size={16} />
      </button>
      <h2>
        <span className="mi">
          <Icon name={icon} size={17} />
        </span>
        {title}
      </h2>
      {sub && <p className="sd">{sub}</p>}
    </>
  )
}
