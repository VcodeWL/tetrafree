import test from 'node:test'
import assert from 'node:assert/strict'
import { parseStream, cleanBody } from './protocol'

const example =
  '<run>echo hello</run>\n<delete path="example.txt" />\n<mcp server="demo" tool="status">{}</mcp>'
for (const fence of ['```', '````', '~~~']) {
  test(`literal documentation fence ${fence} is never dispatched`, () => {
    const source = `${fence}xml\n${example}\n${fence}\n<read path="notes.txt" />`
    for (const streaming of [true, false]) {
      const ops = parseStream(source, streaming).filter((s) => s.t === 'op')
      assert.equal(ops.length, 1)
      assert.equal(ops[0].kind, 'read')
      const partial = `${fence}xml\n${example}`
      assert.equal(parseStream(partial, streaming).filter((s) => s.t === 'op').length, 0)
    }
  })
}
test('long fence keeps inner triple fence literal', () => {
  const source = '````markdown\n```xml\n' + example + '\n```\n````'
  assert.deepEqual(parseStream(source, false), [{ t: 'text', s: source }])
})
test('intentional file-path fence fallback retains body and streaming state', () => {
  const source = '```js src/sample.js\nconsole.log("hello")\n```\n'
  const op = parseStream(source, false)[0]
  assert.equal(op.t, 'op')
  if (op.t !== 'op') return
  assert.equal(op.kind, 'write')
  assert.equal(op.attrs.path, 'src/sample.js')
  assert.equal(cleanBody(op.body), 'console.log("hello")')
  assert.equal(op.closed, true)
  const unfinished = parseStream(source.slice(0, source.indexOf('\n```', 5)), true)[0]
  assert.equal(unfinished.t === 'op' && unfinished.closed, false)
})
test('outer write tag still owns fenced code body', () => {
  const op = parseStream('<write path="a.txt">\n```txt\nhello\n```\n</write>', false)[0]
  assert.equal(op.t === 'op' && cleanBody(op.body), 'hello')
})

const containerExamples = [
  '> ```xml\n> <read path="guide.txt" />\n> ```',
  '- documentation\n\n    ```xml\n    <read path="guide.txt" />\n    ```',
  '> > ~~~xml\n> > <read path="guide.txt" />\n> > ~~~',
  '- ```xml\n  <read path="guide.txt" />\n  ```',
  '1. ```xml\n   <read path="guide.txt" />\n   ```',
  '> - ```xml\n>   <read path="guide.txt" />\n>   ```',
  '    ```xml\n    <read path="guide.txt" />',
  '> ```xml\n> <read path="guide.txt" />',
]
for (const [index, source] of containerExamples.entries()) {
  test(`F04 container documentation fence ${index + 1} is literal (parse-only benign read)`, () => {
    for (const streaming of [false, true]) {
      assert.equal(parseStream(source, streaming).filter((s) => s.t === 'op').length, 0)
      assert.deepEqual(parseStream(source, false), [{ t: 'text', s: source }])
    }
  })
}
test('F04 closing container fence allows a later explicit top-level read', () => {
  for (const example of containerExamples.slice(0, 6)) {
    const ops = parseStream(example + '\n<read path="outside.txt" />', false).filter((s) => s.t === 'op')
    assert.equal(ops.length, 1)
    assert.equal(ops[0].kind, 'read')
    assert.equal(ops[0].attrs.path, 'outside.txt')
  }
})
test('F04 file-like header inside container is literal, not the file-write fallback', () => {
  const source = '> ```txt docs/guide.txt\n> <read path="guide.txt" />\n> ```'
  assert.deepEqual(parseStream(source, false), [{ t: 'text', s: source }])
})
test('F04 write bodies preserve container text byte-for-byte', () => {
  const content = '> ```xml\n> <read path="guide.txt" />\n> ```'
  const op = parseStream('<write path="notes.md">\n' + content + '\n</write>', false)[0]
  assert.equal(op.t === 'op' && cleanBody(op.body), content)
})

test('F04 deeper quote fence cannot prematurely close the enclosing documentation fence', () => {
  const source =
    '> ```xml\n> > ```\n> > <read path="guide.txt" />\n> > ```\n> <read path="guide.txt" />\n> ```'
  assert.deepEqual(parseStream(source, false), [{ t: 'text', s: source }])
  assert.equal(parseStream(source, true).filter((s) => s.t === 'op').length, 0)
})
test('F04 tab-indented and mixed nested containers stay literal', () => {
  for (const source of [
    '- notes\n\n\t```xml\n\t<read path="guide.txt" />\n\t```',
    '  1) > - ~~~xml\n     >   <read path="guide.txt" />\n     >   ~~~',
  ]) {
    assert.deepEqual(parseStream(source, false), [{ t: 'text', s: source }])
    assert.equal(parseStream(source, true).filter((s) => s.t === 'op').length, 0)
  }
})
