import { useState } from 'react'

/** Перетаскиваемая граница панели. Мышь/тач — тянуть, клавиатура — стрелки, двойной клик — сброс. */
export function Resizer({
  axis,
  value,
  min,
  max,
  label,
  className,
  onChange,
  onReset,
  /** +1: рост значения при движении вправо/вниз; -1: наоборот (нижняя панель растёт вверх) */
  dir = 1,
}: {
  axis: 'x' | 'y'
  value: number
  min: number
  max: number
  label: string
  className: string
  onChange: (v: number) => void
  onReset: () => void
  dir?: 1 | -1
}) {
  const [on, setOn] = useState(false)
  return (
    <div
      className={className + (on ? ' on' : '')}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      title={label + ' · двойной клик — сбросить'}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const k = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
        const i = k.indexOf(e.key)
        if (i < 0) return
        e.preventDefault()
        const step = e.shiftKey ? 40 : 10
        onChange(value + (i === 1 ? 1 : -1) * dir * step)
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        const start = axis === 'x' ? e.clientX : e.clientY
        const v0 = value
        setOn(true)
        const cls = axis === 'x' ? 'resizing' : 'resizing-row'
        document.body.classList.add(cls)
        const move = (ev: PointerEvent) =>
          onChange(v0 + dir * ((axis === 'x' ? ev.clientX : ev.clientY) - start))
        const up = () => {
          setOn(false)
          document.body.classList.remove(cls)
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
    />
  )
}
