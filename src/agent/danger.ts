/* Уровень автономности «Спросить»: опасные действия — удаление, установка пакетов, деплой — только после «да».
   Файловые правки такого уровня и так идут карточками на подтверждение; здесь — то же для команд. */

const PKG = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx', 'pnpx', 'bunx'])
const PKG_BAD = new Set([
  'install',
  'i',
  'add',
  'remove',
  'rm',
  'uninstall',
  'un',
  'update',
  'upgrade',
  'up',
  'ci',
  'publish',
  'link',
  'dlx',
  'exec',
  'create',
  'init',
])
const INSTALLERS = new Set([
  'pip',
  'pip3',
  'pipx',
  'apt',
  'apt-get',
  'brew',
  'choco',
  'winget',
  'scoop',
  'gem',
  'composer',
])
const ALWAYS = new Set([
  'rm',
  'rmdir',
  'del',
  'erase',
  'rd',
  'remove-item',
  'ri',
  'shutdown',
  'reboot',
  'format',
  'mkfs',
  'dd',
  'sudo',
  'runas',
  'chown',
  'taskkill',
  'kill',
  'killall',
  'reg',
  'vercel',
  'netlify',
  'firebase',
  'heroku',
  'flyctl',
  'fly',
  'wrangler',
  'surge',
  'terraform',
  'kubectl',
  'helm',
  'ansible',
  'scp',
  'rsync',
  'ssh',
])

/** Слова в кавычках — это данные (`echo "rm -rf"`), а не команда: вырезаем их, прежде чем разбирать. */
const unquote = (s: string) => s.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""')

/** Возвращает причину, если команде нужно разрешение пользователя, иначе null. */
export function dangerOf(cmd: string): string | null {
  const flat = unquote(cmd)
  if (/\b(curl|wget|iwr|irm|invoke-webrequest)\b[^|;&]*\|\s*(sh|bash|zsh|iex|powershell|pwsh)\b/i.test(flat))
    return 'скачивает и запускает скрипт из сети'
  for (const seg of flat.split(/&&|\|\||;|\||\r?\n/)) {
    const w = seg.trim().split(/\s+/).filter(Boolean)
    while (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) w.shift()
    if (!w.length) continue
    const bin = w[0]
      .replace(/^.*[\\/]/, '')
      .replace(/\.(exe|cmd|bat|ps1)$/i, '')
      .toLowerCase()
    const args = w.slice(1).filter((a) => !a.startsWith('-'))
    const sub = (args[0] || '').toLowerCase()
    if (ALWAYS.has(bin)) return bin === 'sudo' || bin === 'runas' ? 'повышает права' : `команда «${bin}»`
    if (PKG.has(bin) && PKG_BAD.has(sub)) return `менеджер пакетов: ${bin} ${sub}`
    if (INSTALLERS.has(bin) && /^(install|uninstall|remove|add|upgrade|update|purge)$/.test(sub))
      return `установка или удаление программ: ${bin} ${sub}`
    if (
      (bin === 'python' || bin === 'python3' || bin === 'py') &&
      w[1] === '-m' &&
      /^pip3?$/.test(w[2] || '') &&
      /^(install|uninstall)$/.test(w[3] || '')
    )
      return 'установка пакетов Python'
    if (bin === 'cargo' && /^(install|publish|uninstall)$/.test(sub)) return `cargo ${sub}`
    if (bin === 'docker' && /^(push|rm|rmi|system|volume|compose)$/.test(sub)) return `docker ${sub}`
    if (bin === 'git') {
      const rest = w.slice(1).join(' ')
      if (
        /^(push|clean)\b/.test(rest) ||
        /\breset\b.*--hard/.test(rest) ||
        /\bbranch\b.*\s-D\b/.test(rest) ||
        /\bcheckout\b.*\s--\s/.test(rest) ||
        /\bstash\b\s+(drop|clear)/.test(rest)
      )
        return `git ${rest.split(/\s+/)[0]} — может потерять данные или отправить код наружу`
    }
  }
  return null
}
