/* Инструкции проекта для агента. Как в Claude Code и OpenCode: AGENTS.md (или CLAUDE.md) в корне проекта описывает
   архитектуру и правила, и агент учитывает их в каждом ходе. `.tetra/rules.md` — правила, заданные в TetraFree. */
export const RULE_FILES = ['.tetra/rules.md', 'AGENTS.md', 'CLAUDE.md'] as const
const CAP = 6000

/** Текст для системной инструкции или '' — если инструкций нет. Файлы с одним лишь «@AGENTS.md» не дублируем. */
export function projectRules(files: Record<string, string>): string {
  const out: string[] = []
  let left = CAP
  const add = (name: string, body: string) => {
    const t = body.trim()
    if (!t || left <= 0) return
    const cut = t.slice(0, left)
    left -= cut.length
    out.push(`--- ${name} ---\n${cut}${cut.length < t.length ? '\n…(обрезано)' : ''}`)
  }
  add('.tetra/rules.md', files['.tetra/rules.md'] || '')
  const agents = files['AGENTS.md']
  if (agents) add('AGENTS.md', agents)
  /* CLAUDE.md часто состоит из одной строки «@AGENTS.md» — это ссылка, а не отдельная инструкция */
  const claude = (files['CLAUDE.md'] || '').replace(/^\s*@AGENTS\.md\s*$/m, '').trim()
  if (claude && !(agents && claude === files['CLAUDE.md'].trim() && claude === agents.trim()))
    add('CLAUDE.md', claude)
  return out.join('\n\n')
}
