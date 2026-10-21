import type { ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
  size?: 'normal' | 'small'
}

/** Общая геометрия кнопок. Поведение и разрешения остаются у вызывающего кода. */
export function ActionButton({
  variant = 'secondary',
  size = 'normal',
  className = '',
  type = 'button',
  ...props
}: Props) {
  const tone = { primary: 'pri', secondary: '', quiet: 'gho', danger: 'danger' }[variant]
  return (
    <button
      type={type}
      className={['btn', tone, size === 'small' ? 'sm' : '', className].filter(Boolean).join(' ')}
      {...props}
    />
  )
}
