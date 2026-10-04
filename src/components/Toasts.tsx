import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'
import { Icon } from './ui/Icon'

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className={'toast ' + (t.tone || '')}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, transition: { duration: 0.16 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            <span className="ti">
              <Icon name={t.icon || (t.tone === 'err' ? 'warn' : 'check')} size={15} />
            </span>
            <div className="tx">
              <b>{t.title}</b>
              {t.desc && <span>{t.desc}</span>}
            </div>
            {t.action && (
              <button
                className="ta"
                onClick={() => {
                  t.action!.run()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="tclose" onClick={() => dismiss(t.id)} aria-label="Закрыть">
              <Icon name="x" size={13} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
