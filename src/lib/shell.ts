/* Подсказки для построчного режима терминала. Сами команды выполняет реальный shell на бэкенде. */
import type { Project } from '../types'
import { useStore } from '../store'

const C = { teal: '\x1b[38;2;143;230;192m', vio: '\x1b[38;2;165;150;255m', r: '\x1b[0m' }
export const PROMPT = (p: Project, cwd: string) =>
  `${C.teal}${useStore.getState().people.me.name.toLowerCase().replace(/\s+/g, '')}@${p.name}${C.r}:${C.vio}~${cwd ? '/' + cwd : ''}${C.r}$ `

export const COMPLETIONS = [
  'ls',
  'cd',
  'pwd',
  'cat',
  'git status',
  'git log',
  'git diff',
  'npm install',
  'npm test',
  'npm run',
  'node',
  'python',
]
