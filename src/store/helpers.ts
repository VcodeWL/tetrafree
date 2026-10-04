import type { ID, Project } from '../types'
import type { S } from './types'

/** запомнить удаление в облачном проекте — иначе при слиянии удалённое «воскреснет» из чужой копии */
export const tomb = (p: Project, id: ID) => {
  if (p.cloud) {
    const t = (p.cloud.tomb ||= {})
    t[id] = Date.now()
    const old = Date.now() - 90 * 864e5
    for (const k in t) if (t[k] < old) delete t[k]
  }
}
export const find = (s: S, pid?: ID | null) => s.projects.find((p) => p.id === (pid ?? s.projectId))
export const chatOf = (p: Project | undefined, id: ID) => p?.chats.find((c) => c.id === id)

export function uniqName(ps: Project[], base: string, except?: ID) {
  let name = base,
    i = 2
  while (ps.some((x) => x.name === name && x.id !== except)) name = base + '-' + i++
  return name
}

export function pickFile(p: Project) {
  const keys = Object.keys(p.files)
  return (
    keys.find((k) => k.startsWith('source/') && !k.endsWith('.html')) ||
    keys.find((k) => /^(docs\/)?readme\.md$/i.test(k)) ||
    keys.find((k) => !k.startsWith('env/') && !k.startsWith('.')) ||
    keys.find((k) => !k.startsWith('env/')) ||
    keys[0] ||
    null
  )
}
