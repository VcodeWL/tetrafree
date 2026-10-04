/* Пайплайны из .tetra/pipelines/*.yaml. Каждый шаг — настоящая команда, выполняемая shell-ом бэкенда
   в папке проекта; логи стримятся в панель запусков. Без запущенного бэкенда пайплайн не стартует. */
import { useStore, toast } from '../store'
import type { DeployRun, ID } from '../types'
import { uid } from '../lib/util'
import { backendOnline, bExec } from '../lib/backend'
import { reconcile } from '../lib/sync'
import { pipelinesFor, type TriggerEvent } from './triggers'

const S = () => useStore.getState()
export interface PipelineDef {
  file: string
  name: string
  trigger: string[]
  steps: { name: string; run: string }[]
}

export function parsePipeline(file: string, src: string): PipelineDef {
  const name =
    src.match(/^name:\s*(.+)$/m)?.[1].trim() ||
    file
      .split('/')
      .pop()!
      .replace(/\.ya?ml$/, '')
  const trigger = (src.match(/^trigger:\s*\[(.*)\]/m)?.[1] || 'manual')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  const steps: PipelineDef['steps'] = []
  const re = /-\s*name:\s*(.+)\n\s+run:\s*(.+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) steps.push({ name: m[1].trim(), run: m[2].trim() })
  return { file, name, trigger, steps }
}
export function pipelinesOf(files: Record<string, string>) {
  return Object.keys(files)
    .filter((f) => f.startsWith('.tetra/pipelines/') && /\.ya?ml$/.test(f))
    .sort()
    .map((f) => parsePipeline(f, files[f]))
}

let active: ID | null = null
let fireTimer = 0
/** Событие проекта → запуск подходящих пайплайнов, если включён «Автодеплой». Только при живом бэкенде: симуляции сами не стартуют. */
export function fireTrigger(pid: ID, ev: TriggerEvent) {
  window.clearTimeout(fireTimer)
  fireTimer = window.setTimeout(async () => {
    const st = S()
    const p = st.projects.find((x) => x.id === pid)
    if (!p?.deploy.auto || st.projectId !== pid || !backendOnline()) return
    for (const d of pipelinesFor(pipelinesOf(p.files), ev)) await runPipeline(d.name)
  }, 2500)
}
export const pipelineRunning = () => active !== null

export async function runPipeline(name = 'release') {
  const st = S()
  const pid = st.projectId
  if (!pid) return
  if (active) {
    toast({ title: 'Пайплайн уже идёт', desc: 'Дождись окончания текущего запуска', icon: 'clock' })
    return
  }
  const p = st.projects.find((x) => x.id === pid)!
  const def = pipelinesOf(p.files).find((x) => x.name === name) || pipelinesOf(p.files)[0]
  if (!def) {
    toast({ title: 'Нет пайплайнов', desc: 'Добавь файл в .tetra/pipelines/', tone: 'warn', icon: 'warn' })
    return
  }
  if (!backendOnline()) {
    toast({
      title: 'Сервер не запущен',
      desc: 'Шаги пайплайна — настоящие команды, им нужен бэкенд TetraFree',
      tone: 'warn',
      icon: 'warn',
    })
    return
  }
  const v = p.versions[p.versions.length - 1]
  const release = def.name === 'release'
  const run: DeployRun = {
    id: uid('r'),
    kind: release ? 'release' : 'preview',
    pipeline: def.name,
    version: v?.n ?? 0,
    at: Date.now(),
    status: 'running',
    by: st.people.me.name,
    log: [`# пайплайн ${def.name} (${def.file}) · ${p.path}`],
    steps: def.steps.map((s) => ({ name: s.name, detail: s.run, state: 'wait' })),
  }
  active = run.id
  const up = (fn: (r: DeployRun) => void) =>
    S().up((pp) => {
      const r = pp.deploy.runs.find((x) => x.id === run.id)
      if (r) fn(r)
    }, pid)
  S().up((pp) => {
    pp.deploy.runs.unshift(run)
    pp.deploy.runs = pp.deploy.runs.slice(0, 20)
  }, pid)
  try {
    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i]
      up((r) => {
        r.steps[i].state = 'run'
        r.log.push(`▸ ${step.name}`, `  $ ${step.run}`)
      })
      await reconcile(pid, { quiet: true })
      let buf = ''
      const flushLines = (final = false) => {
        const parts = buf.split('\n')
        buf = final ? '' : parts.pop() || ''
        const add = (final ? parts.concat(buf) : parts)
          .map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''))
          .filter((l) => l.trim())
        if (add.length) up((r) => r.log.push(...add.map((l) => '  ' + l)))
      }
      const r = await bExec(p, step.run, {
        timeout: 900,
        onOut: (d) => {
          buf += d
          flushLines()
        },
      })
      flushLines(true)
      await reconcile(pid, { quiet: true })
      if (r.code !== 0) throw new Error(`шаг «${step.name}» завершился с кодом ${r.code}`)
      up((r) => {
        r.steps[i].state = 'ok'
      })
    }
    up((r) => {
      r.status = 'ok'
      r.log.push(`✓ ${def.name} завершён`)
    })
    if (release && v)
      S().up((pp) => {
        const vv = pp.versions.find((x) => x.n === v.n)
        if (vv) vv.tag = 'release'
      }, pid)
    toast({
      title: release ? `Релиз v${v?.n} выпущен` : 'Превью обновлено',
      desc: def.name,
      icon: 'rocket',
      tone: 'ok',
    })
  } catch (e) {
    up((r) => {
      r.status = 'failed'
      r.log.push('✕ ' + (e as Error).message)
      const s = r.steps.find((x) => x.state === 'run')
      if (s) s.state = 'fail'
    })
  } finally {
    active = null
  }
}
