import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slug, localDay } from './util'

test('slug: кириллица транслитерируется, остальное чистится', () => {
  assert.equal(slug('Тест проект'), 'test-proekt')
  assert.equal(slug('  Щука & Ёж!! '), 'schuka-ezh')
  assert.equal(slug('мой_API v2'), 'moy-api-v2')
  assert.equal(slug('!!!'), 'project')
})

test('localDay: локальная дата, а не UTC', () => {
  assert.equal(localDay(new Date(2025, 0, 5, 23, 59)), '2025-01-05')
  assert.equal(localDay(new Date(2025, 11, 31, 0, 1)), '2025-12-31')
})
