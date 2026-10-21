import { useEffect, useRef } from 'react'

/** Декоративный перелив, не индикатор прогресса. Нет таймеров или RAF-цикла. */
export function GradientRibbon() {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const sync = () => {
      if (ref.current) ref.current.classList.toggle('paused', document.hidden)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])
  return (
    <span ref={ref} className="ui-ribbon" aria-hidden="true">
      <i />
    </span>
  )
}
