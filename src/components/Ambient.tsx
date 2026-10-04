/* Фон приложения: слои (фоновое изображение, свечения, искры) + курсорное свечение.
   Макро-анимации — медленный дрейф свечений и сетки, параллакс от курсора (десятки секунд).
   Микро — мерцание искр и мягкий свет под курсором. Всё на transform/opacity, пауза в фоновом окне. */
import { useEffect, useRef } from 'react'
import bg from '../assets/bg.jpg'

/* детерминированные «искры»: позиция, размер, период и сдвиг мерцания */
const SPARKS = Array.from({ length: 22 }, (_, i) => {
  const a = (i * 9301 + 49297) % 233280
  const b = (i * 7411 + 12011) % 99991
  return {
    x: (a % 1000) / 10,
    y: (b % 1000) / 10,
    s: 1.5 + ((a >> 3) % 3),
    d: 3.2 + ((b >> 2) % 50) / 10,
    o: -(((a >> 1) % 70) / 10),
  }
})

export function Ambient({ still }: { still: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const vis = () => el.classList.toggle('paused', document.hidden)
    vis()
    document.addEventListener('visibilitychange', vis)
    if (still || reduce) return () => document.removeEventListener('visibilitychange', vis)
    let raf = 0
    let x = 0.5
    let y = 0.3
    let px = 0
    let py = 0
    const tick = () => {
      raf = 0
      el.style.setProperty('--mx', x * 100 + '%')
      el.style.setProperty('--my', y * 100 + '%')
      el.style.setProperty('--px', px.toFixed(3))
      el.style.setProperty('--py', py.toFixed(3))
    }
    const move = (e: PointerEvent) => {
      x = e.clientX / window.innerWidth
      y = e.clientY / window.innerHeight
      px = x - 0.5
      py = y - 0.5
      if (!raf) raf = requestAnimationFrame(tick)
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => {
      window.removeEventListener('pointermove', move)
      document.removeEventListener('visibilitychange', vis)
      cancelAnimationFrame(raf)
    }
  }, [still])

  return (
    <div id="bg" ref={ref} aria-hidden="true">
      <i className="bg-orb o1" />
      <i className="bg-orb o2" />
      <i className="bg-orb o3" />
      <div className="bg-img">
        <img src={bg} alt="" draggable={false} />
      </div>
      <div className="bg-sparks">
        {SPARKS.map((s, i) => (
          <b
            key={i}
            style={{
              left: s.x + '%',
              top: s.y + '%',
              width: s.s,
              height: s.s,
              animationDuration: s.d + 's',
              animationDelay: s.o + 's',
            }}
          />
        ))}
      </div>
      <i className="bg-cursor" />
    </div>
  )
}
