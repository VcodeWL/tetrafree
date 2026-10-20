/* Ordinary Git only, owned temporary repository, no remotes/network/hooks/config payloads. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { assertGitMetadata, gitInvocation } from './git-safety.mjs'
import { createProcessRegistry } from './process-safety.mjs'
import { captureProcess } from './owned-process.mjs'
let available = false
try {
  execFileSync('git', ['--version'], { stdio: 'ignore', timeout: 5000 })
  available = true
} catch {
  /* portable missing dependency */
}
test(
  'restricted profile preserves ordinary init/add/commit/status/diff/log/blame/branch',
  { skip: !available },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tf-git-profile-'))
    const registry = createProcessRegistry()
    const git = async (args) => {
      await assertGitMetadata(root)
      const i = gitInvocation(root, args)
      return captureProcess('git', i.args, {
        cwd: root,
        env: {
          ...i.env,
          GIT_AUTHOR_NAME: 'Fixture',
          GIT_AUTHOR_EMAIL: 'fixture@example.test',
          GIT_COMMITTER_NAME: 'Fixture',
          GIT_COMMITTER_EMAIL: 'fixture@example.test',
        },
        registry,
        timeout: 5000,
      })
    }
    try {
      assert.equal((await git(['init', '-q', '-b', 'main'])).code, 0)
      await fs.writeFile(path.join(root, 'fixture.txt'), 'first\n')
      assert.equal((await git(['add', '--', 'fixture.txt'])).code, 0)
      assert.equal((await git(['commit', '-q', '-m', 'benign fixture'])).code, 0)
      assert.equal((await git(['status', '--porcelain'])).so, '')
      await fs.writeFile(path.join(root, 'fixture.txt'), 'second\n')
      const diff = await git(['diff', '--', 'fixture.txt'])
      assert.equal(diff.code, 0)
      assert.match(diff.so, /second/)
      const log = await git(['log', '-1', '--format=%s'])
      assert.equal(log.code, 0)
      assert.match(log.so, /benign fixture/)
      const blame = await git(['blame', '--line-porcelain', '--', 'fixture.txt'])
      assert.equal(blame.code, 0, blame.se)
      assert.match(blame.so, /second/)
      assert.equal((await git(['branch', 'fixture-branch'])).code, 0)
    } finally {
      await registry.shutdown()
      await fs.rm(root, { recursive: true, force: true })
    }
  },
)
