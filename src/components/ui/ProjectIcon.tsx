import mark from '../../assets/project-mark.png'
import { Icon, type IconName } from './Icon'

/** Новый общий знак проекта. Пользовательские и тематические иконки не заменяются. */
export function ProjectIcon({ name, size = 24 }: { name: IconName; size?: number }) {
  return name === 'sparkle' ? (
    <img className="project-mark" src={mark} width={size} height={size} alt="" draggable={false} />
  ) : (
    <Icon name={name} size={size} />
  )
}
