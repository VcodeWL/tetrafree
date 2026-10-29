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

test('recorded Windows 11 cmd output separates the UTF-8 record from the cursor-positioned prompt', () => {
  const output =
    '\x1b[?9001h\x1b[?1004h\x1b[?25l\x1b[2J\x1b[m\x1b[H' +
    'Microsoft Windows [Version 10.0.26100.33650]\x1b]0;C:\\Windows\\SYSTEM32\\cmd.exe\x07' +
    '\x1b[?25h\x1b[?25l\r\n(c) Microsoft Corporation. All rights reserved.' +
    '\x1b[4;1HD:\\a\\tetrafree\\tetrafree>\x1b[?25h"console-probe.exe" ba367518d32d 8732e8c850f1\r\n' +
    '\x1b]0;cmd.exe - console-probe.exe\x07TFEXEC:ba367518d32d8732e8c850f1\r\n' +
    '\x1b[?25lTFSIZE:80x24\r\nTFUTF:Привет\x1b[10;1HD:\\a\\tetrafree\\tetrafree>' +
    '\x1b]0;Administrator: cmd.exe\x07\x1b[?25h'
  assert.equal(hasOutputRecord(output, 'TFEXEC:ba367518d32d8732e8c850f1'), true)
  assert.equal(hasOutputRecord(output, 'TFSIZE:80x24'), true)
  assert.equal(hasOutputRecord(output, 'TFUTF:Привет'), true)
})

test('vertical VT cursor moves preserve record boundaries without requiring CRLF', () => {
  for (const move of ['\x1b[10;1H', '\x1b[10;1f', '\x1b[10d', '\x1b[B', '\x1b[E', '\x1b[e']) {
    assert.equal(hasOutputRecord(`TFUTF:Привет${move}C:\\>`, 'TFUTF:Привет'), true, JSON.stringify(move))
  }
  for (const move of ['\x1b[A', '\x1b[F']) {
    assert.equal(hasOutputRecord(`\x1b[3;1HTFUTF:Привет${move}C:\\>`, 'TFUTF:Привет'), true)
  }
})

test('same-row cursor moves and styling cannot turn prefixes or suffixes into output records', () => {
  for (const move of ['\x1b[1;1H', '\x1b[1;1f', '\x1b[1d', '\x1b[1G', '\x1b[3C', '\x1b[0m']) {
    assert.equal(hasOutputRecord(`TFEXEC:foobar${move} suffix\r\n`, 'TFEXEC:foobar'), false)
    assert.equal(hasOutputRecord(`PS> echo ${move}TFEXEC:foobar\r\n`, 'TFEXEC:foobar'), false)
  }
})

test('PowerShell erase-character sequences do not hide executed output or console dimensions', () => {
  const output = '\x1b[?25h42_ok\x1b[68X\r\n100\x1b[70X\r\nPS C:\\>'
  assert.equal(hasOutputRecord(output, '42_ok'), true)
  assert.equal(hasOutputRecord(output, '100'), true)
  assert.equal(hasOutputRecord(output, '120'), false)
})

test('OSC titles use their first BEL or ST terminator and never count as executed output', () => {
  for (const end of ['\x07', '\x1b\\']) {
    assert.equal(hasOutputRecord(`\x1b]0;TFEXEC:foobar${end}PS>`, 'TFEXEC:foobar'), false)
    assert.equal(hasOutputRecord(`\x1b]0;title${end}TFEXEC:foobar\r\n`, 'TFEXEC:foobar'), true)
  }
  assert.equal(hasOutputRecord('\x1b]0;first\x1b\\TFEXEC:foobar\r\n\x1b]0;second\x07', 'TFEXEC:foobar'), true)
  assert.equal(hasOutputRecord('\x1b]0;unfinished\r\nTFEXEC:foobar', 'TFEXEC:foobar'), false)
})

function fakeTerminal({
  echoOnly = false,
  resize = true,
  exit = 0,
  hang = false,
  utf = 'Привет',
  vt = false,
  fragmented = false,
} = {}) {
  const p = new EventEmitter()
  p.stdout = new PassThrough()
  p.stderr = new PassThrough()
  p.stdin = new PassThrough()
  let size = '80x24'
  const write = (text) => {
    const bytes = Buffer.from(text)
    if (fragmented) {
      for (let at = 0; at < bytes.length; at += 2) p.stdout.write(bytes.subarray(at, at + 2))
    } else p.stdout.write(bytes)
  }
  p.stdin.on('data', (data) => {
    const text = data.toString()
    if (echoOnly) {
      write(text)
      return
    }
    if (text.startsWith('\0TFRSZ ')) {
      if (resize) size = text.slice(7).trim().replace(' ', 'x')
      return
    }
    if (text.startsWith('exit')) {
      if (!hang) queueMicrotask(() => p.emit('close', exit))
      return
    }
    write(`\r\nTFEXEC:foobar\r\nTFSIZE:${size}\r\nTFUTF:${utf}${vt ? '\x1b[10;1HPS C:\\> ' : '\r\n'}`)
  })
  setTimeout(() => write('PS C:\\> '), 0)
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

test('exact production smoke accepts UTF-8 Cyrillic with the UTF gate enabled', async () => {
  await probeTerminal(fakeTerminal(), { ...options, checkUtf: true })
})
test('exact production smoke accepts fragmented UTF-8 and VT-positioned Windows prompts', async () => {
  await probeTerminal(fakeTerminal({ vt: true, fragmented: true }), { ...options, checkUtf: true })
})
test('exact production smoke rejects lossy Cyrillic output from a legacy code page', async () => {
  await assert.rejects(
    probeTerminal(fakeTerminal({ utf: '??????' }), { ...options, checkUtf: true }),
    /UTF-8 Cyrillic output missing/,
  )
})
test('native smoke producer selects BOM-free UTF-8 before any console output (static)', () => {
  const source = fs.readFileSync(new URL('./smoke-win.mjs', import.meta.url), 'utf8')
  const probe = source.slice(
    source.indexOf('const PROBE_CS ='),
    source.indexOf('async function compileProbe'),
  )
  const encoding = probe.indexOf('Console.OutputEncoding = new System.Text.UTF8Encoding(false);')
  const firstWrite = probe.indexOf('Console.WriteLine(')
  assert.ok(encoding >= 0 && encoding < firstWrite)
})

test('release gates identical SHA, drafts publication and uses immutable actions/locked Cargo (static)', () => {
  const ci = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const release = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
  assert.match(release, /uses: \.\/\.github\/workflows\/ci.yml/)
  assert.match(release, /needs: verify/)
  assert.match(release, /releaseDraft: true/)
  assert.match(release, /-- --locked/)
  assert.match(ci, /cargo check --locked/)
  assert.match(ci.slice(ci.indexOf('  windows:')), /run: npm run check/)
  assert.match(ci, /node scripts\/smoke-win.mjs/)
  for (const text of [ci, release]) {
    assert.match(text, /ref: '\$\{\{ github.sha \}\}'/)
    for (const match of text.matchAll(/uses: (\S+)/g)) {
      if (!match[1].startsWith('./')) assert.match(match[1], /@[a-f0-9]{40}$/)
    }
  }
  assert.ok(fs.existsSync(new URL('../src-tauri/Cargo.lock', import.meta.url)))
})
