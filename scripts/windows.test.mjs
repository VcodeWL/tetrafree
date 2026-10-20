import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { copySidecar, nodeTriple, sidecarTriple } from './prepare-sidecar.mjs'
import { hasOutputRecord, probeTerminal } from './smoke-win.mjs'

test('same-sized stale sidecar is replaced by digest; identical runtime is retained', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-sidecar-test-'))
  try {
    const source = path.join(dir, 'source'),
      dest = path.join(dir, 'dest')
    fs.writeFileSync(source, 'NEW-RUNTIME')
    fs.writeFileSync(dest, 'OLD-RUNTIME')
    assert.equal(fs.statSync(source).size, fs.statSync(dest).size)
    assert.equal(copySidecar(source, dest), true)
    assert.equal(fs.readFileSync(dest, 'utf8'), 'NEW-RUNTIME')
    assert.equal(copySidecar(source, dest), false)
    assert.deepEqual(fs.readdirSync(dir).sort(), ['dest', 'source'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('sidecar name matches executing Node architecture, not an incompatible rust host', () => {
  assert.equal(nodeTriple('win32', 'arm64'), 'aarch64-pc-windows-msvc')
  assert.equal(nodeTriple('win32', 'x64'), 'x86_64-pc-windows-msvc')
  assert.throws(() => nodeTriple('linux', 'mips'))
  assert.equal(sidecarTriple(nodeTriple(), nodeTriple()), nodeTriple())
  assert.throws(() => sidecarTriple('incompatible-target', 'incompatible-target'))
})

test('output records must be exact lines, not echoed command substrings', () => {
  assert.equal(hasOutputRecord('PS> echo TFEXEC:foobar\r\nPS>', 'TFEXEC:foobar'), false)
  assert.equal(hasOutputRecord('TFEXEC:foobar suffix\r\n', 'TFEXEC:foobar'), false)
  assert.equal(hasOutputRecord('\x1b[32mTFEXEC:foobar\x1b[0m\r\n', 'TFEXEC:foobar'), true)
})

function fakeTerminal({ echoOnly = false, resize = true, exit = 0, hang = false } = {}) {
  const p = new EventEmitter()
  p.stdout = new PassThrough()
  p.stderr = new PassThrough()
  p.stdin = new PassThrough()
  p.stdin.on('data', (data) => {
    const text = data.toString()
    if (echoOnly) {
      p.stdout.write(text)
      return
    }
    if (text.startsWith('\0TFRSZ ')) {
      if (resize) p.stdout.write('TFSIZE:113x37\r\n')
      return
    }
    if (text.startsWith('exit')) {
      if (!hang) queueMicrotask(() => p.emit('close', exit))
      return
    }
    p.stdout.write('\r\nTFEXEC:foobar\r\nTFSIZE:80x24\r\n')
  })
  setTimeout(() => p.stdout.write('PS C:\\> '), 0)
  return p
}
const options = { command: 'probe foo bar\r', expected: 'TFEXEC:foobar', timeout: 100, checkUtf: false }

test('exact production smoke rejects an input-echo-only helper', async () => {
  await assert.rejects(probeTerminal(fakeTerminal({ echoOnly: true }), options), /executed output missing/)
})
test('exact production smoke rejects ignored resize', async () => {
  await assert.rejects(probeTerminal(fakeTerminal({ resize: false }), options), /resize not observed/)
})
test('exact production smoke rejects nonexpected exit', async () => {
  await assert.rejects(probeTerminal(fakeTerminal({ exit: 42 }), options), /expected exit 0, got 42/)
})
test('exact production smoke rejects exit timeout', async () => {
  await assert.rejects(probeTerminal(fakeTerminal({ hang: true }), options), /shell exit timeout/)
})
test('exact production smoke accepts only executed output, size changes and expected exit', async () => {
  await probeTerminal(fakeTerminal(), options)
})

test('release gates identical SHA, drafts publication and uses immutable actions/locked Cargo (static)', () => {
  const ci = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const release = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
  assert.match(release, /uses: \.\/\.github\/workflows\/ci.yml/)
  assert.match(release, /needs: verify/)
  assert.match(release, /releaseDraft: true/)
  assert.match(release, /-- --locked/)
  assert.match(ci, /cargo check --locked/)
  assert.match(ci, /node scripts\/smoke-win.mjs/)
  for (const text of [ci, release]) {
    assert.match(text, /ref: '\$\{\{ github.sha \}\}'/)
    for (const match of text.matchAll(/uses: (\S+)/g)) {
      if (!match[1].startsWith('./')) assert.match(match[1], /@[a-f0-9]{40}$/)
    }
  }
  assert.ok(fs.existsSync(new URL('../src-tauri/Cargo.lock', import.meta.url)))
})
