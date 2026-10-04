import { forwardRef, type ReactNode } from 'react'
import { AGENTS } from '../../data/seed'
import type { Person } from '../../types'
import { useStore } from '../../store'

export function Logo({ size = 40, glow = true }: { size?: number; glow?: boolean }) {
  const img = <img className="logoimg" src="/logo.png" width={size} height={size} alt="" draggable={false} />
  return glow ? <span className="logo-wrap">{img}</span> : img
}
export function Wordmark({ size = 40, text = 22 }: { size?: number; text?: number }) {
  return (
    <span className="wordmark">
      <Logo size={size} />
      <span className="wm-name" style={{ fontSize: text }}>
        Tetra<span className="free">Free</span>
      </span>
    </span>
  )
}

/* Аватар человека: фото или инициалы на тоне, заданном hue */
export function Avatar({
  person,
  size = 26,
  round,
  title,
}: {
  person?: Person | null
  size?: number
  round?: boolean
  title?: string
}) {
  if (!person) return <span className="av" style={{ width: size, height: size }} />
  const st: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.max(8, size * 0.36),
    borderRadius: round ? '50%' : Math.round(size * 0.3),
  }
  if (person.avatar)
    return <img className="av avimg" src={person.avatar} style={st} alt="" title={title ?? person.name} />
  return (
    <span
      className={'av' + (person.pending ? ' pending' : '')}
      title={title ?? person.name}
      style={{
        ...st,
        background: `linear-gradient(135deg, hsl(${person.hue} 32% 86%), hsl(${person.hue} 18% 66%))`,
      }}
    >
      {person.initials}
    </span>
  )
}
export function PersonAv({ id, size, round }: { id: string; size?: number; round?: boolean }) {
  const p = useStore((s) => s.people[id])
  return <Avatar person={p} size={size} round={round} />
}

/* Глифы агентов — простые геометрические знаки вместо сгенерированных «ИИ-лиц» */
const GLYPH: Record<string, string> = {
  hub: '<circle cx="12" cy="12" r="2.6"/><circle cx="5" cy="6" r="1.6"/><circle cx="19" cy="6" r="1.6"/><circle cx="12" cy="20" r="1.6"/><path d="M6.3 7l3.7 3.4M17.7 7 14 10.4M12 14.6v3.8"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z"/>',
  flask:
    '<path d="M9 3h6M10 3v6L4.8 18.2A1.9 1.9 0 0 0 6.5 21h11a1.9 1.9 0 0 0 1.7-2.8L14 9V3"/><path d="M7.5 15h9"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  patch:
    '<rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="M11 11h.01M13 13h.01M11 13h.01M13 11h.01"/>',
  lint: '<path d="M4 6h10M4 12h16M4 18h7"/><path d="m15 17 2 2 4-4"/>',
}
export function AgentAvatar({ name, size = 26 }: { name: string; size?: number }) {
  const g = AGENTS[name]?.glyph || 'hub'
  return (
    <span
      className="av agent"
      title={name}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
    >
      <svg
        width={size * 0.58}
        height={size * 0.58}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: GLYPH[g] }}
      />
    </span>
  )
}
export function ActorAv({ actor, size = 22 }: { actor: import('../../types').Actor | null; size?: number }) {
  if (!actor)
    return (
      <span
        className="av empty"
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
        title="Не назначена"
      />
    )
  return actor.kind === 'agent' ? (
    <AgentAvatar name={actor.name} size={size} />
  ) : (
    <PersonAv id={actor.id} size={size} />
  )
}

export function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={'sw' + (on ? ' on' : '')}
      onClick={() => onChange(!on)}
    >
      <i />
    </button>
  )
}
export const Working = () => (
  <span className="working" role="img" aria-label="работает">
    <i />
    <i />
    <i />
  </span>
)
export const Spin = ({ size = 16 }: { size?: number }) => (
  <span className="tspin" style={{ width: size, height: size }} />
)
export const Kbd = ({ children }: { children: ReactNode }) => <span className="kbd">{children}</span>

export const IconBtn = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { tip?: string }
>(function IconBtn({ tip, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={'iconbtn' + (className ? ' ' + className : '')}
      title={tip}
      aria-label={tip}
      {...rest}
    >
      {children}
    </button>
  )
})

/* Инлайн-разметка **жирный** и `код` для коротких строк (системные сообщения, мета) */
export function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <b key={i}>{p.slice(2, -2)}</b>
        ) : p.startsWith('`') && p.endsWith('`') ? (
          <code key={i}>{p.slice(1, -1)}</code>
        ) : (
          p
        ),
      )}
    </>
  )
}

/* единый сегмент-переключатель: темы, статусы, приоритеты, уровни автономии */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  wide,
  label,
}: {
  value: T
  options: { k: T; t: string; icon?: ReactNode }[]
  onChange: (k: T) => void
  wide?: boolean
  label?: string
}) {
  return (
    <div className={'segmini' + (wide ? ' wide' : '')} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.k}
          type="button"
          role="radio"
          aria-checked={value === o.k}
          className={value === o.k ? 'on' : ''}
          onClick={() => onChange(o.k)}
        >
          {o.icon}
          {o.t}
        </button>
      ))}
    </div>
  )
}
