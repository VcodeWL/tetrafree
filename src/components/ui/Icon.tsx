import { memo } from 'react'
import { ICONS, BRAND_PATHS, type IconName } from './iconData'

export const Icon = memo(function Icon({
  name,
  size = 16,
  stroke = 1.8,
  className,
  style,
}: {
  name: IconName
  size?: number
  stroke?: number
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  )
})

export function BrandIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: BRAND_PATHS[kind] || BRAND_PATHS.custom }}
    />
  )
}
export type { IconName }
