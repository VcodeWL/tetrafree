import { test } from 'node:test'
import assert from 'node:assert/strict'
import { editorSession } from './editorSession'

function fixture(files: Record<string, string>, path = 'README.md') {
  const recovered: string[] = []
  const writes: string[] = []
  const session = editorSession({
    read: () => files[path],
    write: (text) => {
      files[path] = text
      writes.push(text)
    },
    recover: (text) => recovered.push(text),
  })
  return { session, recovered, writes }
}

test('UI01: same filename in A/B, untouched cleanup never writes either project', () => {
  const a = fixture({ 'README.md': 'A' })
  const b = fixture({ 'README.md': 'B' })
  a.session.save('A', 'A')
  b.session.save('B', 'B')
  assert.deepEqual(a.writes, [])
  assert.deepEqual(b.writes, [])
})

test('UI01/UI03: pending cleanup is scoped to its original project/page', () => {
  const aFiles = { 'README.md': 'A', 'site/a.html': 'A', 'site/b.html': 'B' }
  const bFiles = { 'README.md': 'B' }
  const a = fixture(aFiles)
  const b = fixture(bFiles)
  a.session.save('A', 'A_TYPED')
  b.session.save('B', 'B_TYPED')
  assert.equal(aFiles['README.md'], 'A_TYPED')
  assert.equal(bFiles['README.md'], 'B_TYPED')
  const pageA = fixture(aFiles, 'site/a.html')
  const pageB = fixture(aFiles, 'site/b.html')
  pageA.session.save('A', 'A_TYPED')
  pageB.session.save('B', 'B_TYPED')
  assert.equal(aFiles['site/a.html'], 'A_TYPED')
  assert.equal(aFiles['site/b.html'], 'B_TYPED')
})

test('UI04: pending A flush followed by untouched B cleanup cannot overwrite A with B', () => {
  const files = { 'site/a.html': 'A', 'site/b.html': 'B' }
  const a = fixture(files, 'site/a.html')
  a.session.save('A', 'A_TYPED')
  const b = fixture(files, 'site/b.html')
  b.session.save('B', 'B')
  assert.deepEqual(files, { 'site/a.html': 'A_TYPED', 'site/b.html': 'B' })
  assert.deepEqual(a.writes, ['A_TYPED'])
  assert.deepEqual(b.writes, [])
})

test('UI02: deleted file does not resurrect, dirty text goes to recovery exactly on flush', () => {
  const files: Record<string, string> = { 'README.md': 'A' }
  const { session, recovered, writes } = fixture(files)
  delete files['README.md']
  const result = session.save('A', 'UNSAVED_TYPED')
  assert.equal(result.recovered, true)
  assert.equal('README.md' in files, false)
  assert.deepEqual(writes, [])
  assert.deepEqual(recovered, ['UNSAVED_TYPED'])
})

test('UI02: deletion + recreation is a new generation, even with identical content', () => {
  const files: Record<string, string> = { 'README.md': 'A' }
  const { session, recovered } = fixture(files)
  delete files['README.md']
  session.observe()
  files['README.md'] = 'A'
  session.save('A', 'OLD_PENDING')
  assert.equal(files['README.md'], 'A')
  assert.deepEqual(recovered, ['OLD_PENDING'])
})

test('UI02: rename preserves new path, recovers pending text without recreating old path', () => {
  const files: Record<string, string> = { 'README.md': 'A' }
  const { session, recovered } = fixture(files)
  files['new.md'] = files['README.md']
  delete files['README.md']
  session.observe()
  session.save('A', 'PENDING')
  assert.deepEqual(files, { 'new.md': 'A' })
  assert.deepEqual(recovered, ['PENDING'])
})

test('compare-before-save merges external edits arriving before React effects', () => {
  const files = { 'README.md': 'first\nsecond\nthird' }
  const { session } = fixture(files)
  files['README.md'] = 'first\nsecond\nTHIRD'
  session.save('first\nsecond\nthird', 'FIRST\nsecond\nthird')
  assert.equal(files['README.md'], 'FIRST\nsecond\nTHIRD')
})

test('merge conflicts preserve both sides with explicit conflict markers', () => {
  const files = { 'README.md': 'A' }
  const { session } = fixture(files)
  files['README.md'] = 'THEIRS'
  const result = session.save('A', 'OURS')
  assert.equal(result.recovered, false)
  assert.match(files['README.md'], /OURS/)
  assert.match(files['README.md'], /THEIRS/)
  assert.match(files['README.md'], /<<<<<<</)
})

test('unmergeable large edits recover ours instead of overwriting theirs', () => {
  const base = Array.from({ length: 2600 }, (_, i) => `base-${i}`).join('\n')
  const ours = Array.from({ length: 2600 }, (_, i) => `ours-${i}`).join('\n')
  const theirs = Array.from({ length: 2600 }, (_, i) => `theirs-${i}`).join('\n')
  const files = { 'README.md': base }
  const { session, recovered, writes } = fixture(files)
  files['README.md'] = theirs
  const result = session.save(base, ours)
  assert.equal(result.recovered, true)
  assert.equal(files['README.md'], theirs)
  assert.deepEqual(writes, [])
  assert.deepEqual(recovered, [ours])
})
