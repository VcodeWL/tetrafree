/* Контекст git для агента: что изменено и не закоммичено. Добавляется в запрос, только если он про изменения. */
import { bGit, backendOnline, type GitStatus } from './backend'
import { resyncNow } from './sync'
import type { Project } from '../types'

export const wantsGit = (prompt: string) =>
  /(^|[^a-z])(diff|git|review)([^a-z]|$)|коммит|ревью|незакоммич|что я (измен|поменя)|(мои|текущи\S*|мо[ёе]|последни\S*) (изменени|правк)|проверь правки|my changes/i.test(
    prompt,
  )

export function clipDiff(d: string, max: number): string {
  const body = d
    .split('\n')
    .filter((l) => !/^(index |diff --git|new file mode|deleted file mode|similarity |rename )/.test(l))
    .join('\n')
  return body.length > max ? body.slice(0, max) + '\n… обрезано' : body
}

export async function gitContext(
  p: Pick<Project, 'id' | 'name'>,
  files = 4,
  perFile = 3000,
  total = 9000,
): Promise<string> {
  if (!backendOnline()) return ''
  try {
    await resyncNow()
    const s = await bGit<GitStatus>('status', p)
    if (!s.ok || !s.files.length) return s.ok ? '\n\n[git: нет незакоммиченных изменений]' : ''
    const list = s.files.map(
      (f) => `${f.kind === 'new' ? 'A' : f.kind === 'del' ? 'D' : f.kind === 'ren' ? 'R' : 'M'} ${f.path}`,
    )
    let out = `\n\n[git: ветка ${s.branch}, не закоммичено ${s.files.length}:\n${list.slice(0, 30).join('\n')}${list.length > 30 ? `\n… и ещё ${list.length - 30}` : ''}`
    let used = 0
    for (const f of s.files.filter((x) => x.kind !== 'del').slice(0, files)) {
      if (used >= total) break
      const r = await bGit<{ ok: boolean; diff: string; binary?: boolean }>('diff', p, { path: f.path })
      if (!r.ok || r.binary || !r.diff.trim()) continue
      const part = clipDiff(r.diff, Math.min(perFile, total - used))
      used += part.length
      out += `\n\n--- diff ${f.path}\n${part}`
    }
    return out + '\n]'
  } catch {
    return ''
  }
}
