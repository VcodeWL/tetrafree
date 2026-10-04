/* Скрипты package.json проекта → команды для терминала. */
export interface Script {
  name: string
  body: string
  cmd: string
}

export function pkgManager(files: Record<string, string>): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if ('pnpm-lock.yaml' in files) return 'pnpm'
  if ('yarn.lock' in files) return 'yarn'
  if ('bun.lockb' in files || 'bun.lock' in files) return 'bun'
  return 'npm'
}

export function scriptsOf(files: Record<string, string>): Script[] {
  let j: unknown
  try {
    j = JSON.parse(files['package.json'] || '')
  } catch {
    return []
  }
  const sc = (j as { scripts?: unknown })?.scripts
  if (!sc || typeof sc !== 'object') return []
  const pm = pkgManager(files)
  return Object.entries(sc as Record<string, unknown>)
    .filter(([n, b]) => typeof b === 'string' && /^[\w:.\-@/]+$/.test(n))
    .map(([name, body]) => ({
      name,
      body: body as string,
      cmd:
        pm === 'npm'
          ? name === 'start' || name === 'test'
            ? `npm ${name}`
            : `npm run ${name}`
          : `${pm} ${name}`,
    }))
}
