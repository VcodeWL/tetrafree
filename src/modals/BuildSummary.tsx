import { motion } from 'framer-motion'
import { useStore } from '../store'
import { Icon } from '../components/ui/Icon'

/* Итог «К реализации»: что собрано из макета */
export function BuildSummaryOverlay() {
  const s = useStore((x) => x.summary)
  const st = useStore.getState
  if (!s) return null
  const close = () => st().setSummary(null)
  return (
    <div className="modal-wrap open" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <motion.div
        className="bsum-card"
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="bs-ic">
          <Icon name="check" size={22} />
        </div>
        <h2>Экран «{s.screen}» реализован</h2>
        <p>
          Агенты перенесли макет в код, собрали версию и выложили превью. Токены, компоненты и спецификация
          лежат в репозитории.
        </p>
        <div className="bs-stats">
          <div>
            <b>v{s.version}</b>
            <span>версия</span>
          </div>
          <div>
            <b>{s.files}</b>
            <span>файлов</span>
          </div>
          <div>
            <b>{s.components}</b>
            <span>компонентов</span>
          </div>
        </div>
        <div className="bs-acts">
          <button
            className="btn"
            onClick={() => {
              close()
              st().openModal({ type: 'versions', focus: s.version })
            }}
          >
            <Icon name="clock" size={14} />
            Что изменилось
          </button>
          <button
            className="btn pri"
            onClick={() => {
              close()
              st().setMode('dev')
              st().setViewVersion(null)
              st().setRight({ rightOpen: true, rightTab: 'browser' })
            }}
          >
            <Icon name="browser" size={14} />
            Открыть превью
          </button>
        </div>
      </motion.div>
    </div>
  )
}
