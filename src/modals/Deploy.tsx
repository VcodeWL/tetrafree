import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useProject } from '../store'
import { Icon } from '../components/ui/Icon'
import { Modal, MHead } from '../components/ui/Modal'
import { pipelinesOf, runPipeline } from '../agent/ci'
import { ago } from '../lib/util'

export function DeployModal() {
  const p = useProject()!
  const st = useStore.getState
  const pipes = useMemo(() => pipelinesOf(p.files), [p.files])
  const [pipe, setPipe] = useState(pipes.find((x) => x.name === 'release')?.name || pipes[0]?.name)
  const runs = p.deploy.runs
  const running = runs.find((r) => r.status === 'running')
  const [sel, setSel] = useState<string | undefined>(running?.id || runs[0]?.id)
  // setSel только при смене id запущенного деплоя, не на каждый его тик
  useEffect(() => {
    if (running) setSel(running.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running?.id])
  const run = runs.find((r) => r.id === sel)
  const log = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const el = log.current
    if (el) el.scrollTop = el.scrollHeight
  }, [run?.log.length])
  const latest = p.versions[p.versions.length - 1]
  const def = pipes.find((x) => x.name === pipe)
  return (
    <Modal wide label="Деплой" busy={false}>
      <MHead
        icon="rocket"
        title="Деплой"
        sub={
          <>
            Шаги из <code>{def?.file || '.tetra/pipelines/'}</code> выполняются в папке проекта. Текущая
            версия — <b>v{latest?.n ?? 0}</b>.
          </>
        }
      />
      <div className="dp-top">
        <div className="segmini">
          {pipes.map((d) => (
            <button key={d.name} className={pipe === d.name ? 'on' : ''} onClick={() => setPipe(d.name)}>
              <Icon name={d.name === 'release' ? 'rocket' : 'eye'} size={13} />
              {d.name}
            </button>
          ))}
        </div>
        <span className="grow" />
        <button
          className="btn gho sm"
          onClick={() => {
            st().closeModal()
            if (def) st().openFile(def.file)
          }}
          disabled={!def}
        >
          <Icon name="file" size={13} />
          YAML
        </button>
        <button className="btn pri" disabled={!!running || !def} onClick={() => runPipeline(pipe)}>
          {running ? (
            <>
              <span className="bspin" />
              Идёт {running.pipeline}
            </>
          ) : (
            <>
              <Icon name="play" size={13} />
              Запустить {pipe}
            </>
          )}
        </button>
      </div>
      {!pipes.length && (
        <div className="diff-note">
          <Icon name="info" size={14} />В проекте нет пайплайнов. Создай файл в <code>.tetra/pipelines/</code>{' '}
          или попроси агента.
        </div>
      )}
      <div className="dp-body">
        <div className="dp-runs">
          <div className="set-sub">Запуски</div>
          {runs.map((r) => (
            <button
              key={r.id}
              className={'dp-run' + (r.id === run?.id ? ' on' : '')}
              onClick={() => setSel(r.id)}
            >
              <span className={'rstate ' + r.status}>
                {r.status === 'running' ? (
                  <span className="tspin" />
                ) : (
                  <Icon name={r.status === 'ok' ? 'check' : 'x'} size={11} />
                )}
              </span>
              <span className="dpr-x">
                <span className="mono">
                  {r.pipeline || r.kind} · v{r.version}
                </span>
                <span className="dim">
                  {ago(r.at)}
                  {r.by ? ' · ' + r.by.split(' ')[0] : ''}
                </span>
              </span>
            </button>
          ))}
          {!runs.length && <div className="cl-empty">Ещё ни одного запуска.</div>}
        </div>
        <div className="dp-main">
          {run ? (
            <>
              <div className="dp-steps">
                {run.steps.map((s, i) => (
                  <div key={i} className={'dp-step ' + s.state}>
                    <span className="dps-i">
                      {s.state === 'run' ? (
                        <span className="tspin" />
                      ) : s.state === 'ok' ? (
                        <Icon name="check" size={12} />
                      ) : s.state === 'fail' ? (
                        <Icon name="x" size={12} />
                      ) : (
                        <i />
                      )}
                    </span>
                    <span className="dps-n">{s.name}</span>
                    <span className="dps-d mono">{s.detail}</span>
                  </div>
                ))}
              </div>
              {run.log.length || run.status === 'running' ? (
                <pre className="dp-log" ref={log}>
                  {run.log.join('\n')}
                  {run.status === 'running' && <span className="caret" />}
                </pre>
              ) : (
                <div className="dp-nolog">
                  <Icon name="info" size={14} />
                  Для этого запуска лог не сохранился.
                </div>
              )}
              {run.status === 'ok' && (
                <div className="dp-url">
                  <Icon name="check" size={13} />
                  <span>Запуск завершён успешно</span>
                  <span className="grow" />
                  <button
                    className="btn sm"
                    disabled={!p.versions.some((v) => v.n === run.version)}
                    title={
                      p.versions.some((v) => v.n === run.version)
                        ? ''
                        : `Эта версия есть только у ${run.by || 'автора запуска'}`
                    }
                    onClick={() => {
                      st().setViewVersion(run.version === latest?.n ? null : run.version)
                      st().setRight({ rightOpen: true, rightTab: 'browser' })
                      st().closeModal()
                    }}
                  >
                    <Icon name="external" size={12} />
                    Открыть
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="empty-pane">Выбери пайплайн и запусти — шаги и лог появятся здесь.</div>
          )}
        </div>
      </div>
    </Modal>
  )
}
