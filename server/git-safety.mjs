/* Conservative native-Git profile, not an OS/filesystem sandbox. Unknown local
   config fails closed; system/global config is intentionally not consulted.
   Normal init/add/status/diff/commit/branch and HTTPS/SSH remotes remain usable.
   Custom helpers, hooks, filters, includes, linked worktrees and submodules need
   a separate trusted workflow. Concurrent external mutation is still a limit. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { realInside } from './fs-safety.mjs'
import { childEnv } from './process-safety.mjs'
import { publicError } from './public-errors.mjs'
import { checkRemoteUrl } from './gitremote.mjs'
const invalid = () =>
  publicError(
    400,
    'Неподдерживаемая конфигурация или служебная ссылка Git: используй обычный репозиторий без внешних helpers/includes/worktrees',
  )
const keys = {
  core: new Set([
    'repositoryformatversion',
    'filemode',
    'bare',
    'logallrefupdates',
    'ignorecase',
    'precomposeunicode',
    'autocrlf',
    'safecrlf',
    'symlinks',
    'eol',
    'quotepath',
    'longpaths',
  ]),
  user: new Set(['name', 'email']),
  remote: new Set(['url', 'pushurl', 'fetch', 'push', 'tagopt', 'prune']),
  branch: new Set(['remote', 'merge', 'rebase', 'description', 'pushremote']),
  init: new Set(['defaultbranch']),
  pull: new Set(['rebase', 'ff']),
  push: new Set(['default', 'autosetupremote']),
  merge: new Set(['ff', 'conflictstyle']),
  extensions: new Set(['objectformat']),
}
export function validateGitConfig(text) {
  if (Buffer.byteLength(text) > 128 * 1024 || /\0/.test(text)) throw invalid()
  let section = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || /^[#;]/.test(line)) continue
    if (line.startsWith('[')) {
      const m = /^\[([a-z]+)(?: "([^"\\\x00-\x1f]+)")?\]$/i.exec(line)
      if (!m || !keys[m[1].toLowerCase()]) throw invalid()
      section = m[1].toLowerCase()
      if (!!m[2] !== ['remote', 'branch'].includes(section)) throw invalid()
      continue
    }
    const m = /^([a-z][a-z0-9-]*)\s*=\s*(.*?)$/i.exec(line)
    if (!m || !keys[section]?.has(m[1].toLowerCase()) || /[\\\x00-\x1f]/.test(m[2])) throw invalid()
    // Reject continuation/escape/inline-comment ambiguity rather than parse a
    // subtly different language from native Git. Quoted ordinary values work.
    let value = m[2]
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    if (/["#;]/.test(value)) throw invalid()
    const key = m[1].toLowerCase()
    if (section === 'remote' && ['url', 'pushurl'].includes(key) && !checkRemoteUrl(value).ok) throw invalid()
    if (section === 'extensions' && value !== 'sha1' && value !== 'sha256') throw invalid()
  }
}
export async function assertGitMetadata(dir) {
  const root = path.join(dir, '.git')
  const st = await fs.lstat(root).catch((e) => {
    if (e.code === 'ENOENT') return null
    throw e
  })
  if (!st) return
  if (!st.isDirectory() || st.isSymbolicLink()) throw invalid()
  let n = 0
  const walk = async (folder) => {
    for (const ent of await fs.readdir(folder, { withFileTypes: true })) {
      if (++n > 100000) throw invalid()
      const abs = path.join(folder, ent.name),
        rel = path.relative(root, abs).split(path.sep).join('/').toLowerCase()
      if (
        [
          'commondir',
          'config.worktree',
          'modules',
          'objects/info/alternates',
          'objects/info/http-alternates',
          'info/grafts',
        ].includes(rel)
      )
        throw invalid()
      if (ent.isSymbolicLink() || (!ent.isDirectory() && !ent.isFile())) throw invalid()
      await realInside(dir, abs)
      if (rel === 'config' && (await fs.stat(abs)).size > 128 * 1024) throw invalid()
      if (ent.isDirectory()) await walk(abs)
    }
  }
  await realInside(dir, root)
  await walk(root)
  const config = await fs.readFile(path.join(root, 'config'), 'utf8').catch((e) => {
    if (e.code === 'ENOENT') return ''
    throw e
  })
  validateGitConfig(config)
}
export function gitInvocation(dir, args) {
  // Git for Windows recognizes /dev/null, but rejects Node's \\.\nul device path.
  // Keep ambient config, attributes and hooks disabled on every host.
  const devNull = '/dev/null'
  const command = args[0]
  const options = [
    'core.hooksPath=' + devNull,
    'core.attributesFile=' + devNull,
    'core.fsmonitor=false',
    'core.untrackedCache=false',
    'core.sshCommand=ssh -F ' + devNull,
    'credential.helper=',
    'commit.gpgSign=false',
    'tag.gpgSign=false',
    'submodule.recurse=false',
    'fetch.recurseSubmodules=false',
    'protocol.allow=never',
    'protocol.https.allow=always',
    'protocol.ssh.allow=always',
    'diff.external=',
    'core.pager=cat',
  ]
  let base = ['--no-pager', ...options.flatMap((v) => ['-c', v])]
  if (!['clone', 'init'].includes(command))
    base.push('--git-dir=' + path.join(dir, '.git'), '--work-tree=' + dir, '-c', 'core.bare=false')
  if (['diff', 'show', 'log', 'blame'].includes(command))
    args = [command, '--no-ext-diff', '--no-textconv', ...args.slice(1)]
  const env = childEnv()
  for (const k of Object.keys(env)) if (/^(?:GIT_|SSH_ASKPASS)/i.test(k)) delete env[k]
  return {
    args: [...base, ...args],
    env: {
      ...env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: devNull,
      GIT_CONFIG_GLOBAL: devNull,
      GIT_ATTR_NOSYSTEM: '1',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_NO_LAZY_FETCH: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_CEILING_DIRECTORIES: dir,
      GIT_DISCOVERY_ACROSS_FILESYSTEM: '0',
    },
  }
}
