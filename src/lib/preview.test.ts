import test from 'node:test'
import assert from 'node:assert/strict'
import { snapshotPreviewDocument } from './preview'

test('historical snapshot is encoded inside an opaque sandbox', () => {
  const html = '<!doctype html><p title="sample & text">version</p>'
  const doc = snapshotPreviewDocument(html)
  assert.match(doc, /sandbox="allow-scripts allow-forms"/)
  assert.doesNotMatch(doc, /allow-same-origin/)
  assert.match(doc, /srcdoc="&lt;!doctype html&gt;/)
  assert.match(doc, /title=&quot;sample &amp; text&quot;/)
  assert.equal((doc.match(/<iframe /g) || []).length, 1)
})
