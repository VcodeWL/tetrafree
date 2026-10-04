import { useState } from 'react'
import { Icon } from './Icon'
import { copyText } from '../../lib/util'

/* Кнопка «скопировать сообщение»: проявляется при наведении на реплику */
export function CopyBtn({ text, label = 'Скопировать сообщение' }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      className={'msg-copy' + (ok ? ' ok' : '')}
      title={ok ? 'Скопировано' : label}
      aria-label={label}
      onClick={() => {
        copyText(text)
        setOk(true)
        setTimeout(() => setOk(false), 1400)
      }}
    >
      <Icon name={ok ? 'check' : 'copy'} size={12} />
    </button>
  )
}
