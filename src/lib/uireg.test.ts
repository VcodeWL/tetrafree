import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  UI_SOURCES,
  parseIndex,
  filterUi,
  resolveBundle,
  materialize,
  detectLayout,
  customSource,
  cssText,
  addDeps,
  mergeCss,
  safeRel,
  prettify,
  resolveSpec,
  type RegItem,
  type BFile,
} from './uireg'
import { RUNTIME_JS, embedBlock, previewDoc, twCss } from './uirun'

const shadcn = UI_SOURCES[0]
const magic = UI_SOURCES[1]
const f = (path: string, content: string, type = 'registry:ui'): BFile => ({ path, content, type, item: 'x' })

const DB: Record<string, RegItem> = {
  [shadcn.item('dialog')]: {
    name: 'dialog',
    type: 'registry:ui',
    dependencies: ['radix-ui', 'cn'],
    files: [
      {
        path: 'registry/new-york-v4/ui/dialog.tsx',
        type: 'registry:ui',
        content:
          'import { Button } from "@/registry/new-york-v4/ui/button"\nimport { cn } from "cn"\nimport * as D from "radix-ui"\nexport const Dialog = () => <Button className={cn("a")} />',
      },
    ],
  },
  [shadcn.item('button')]: {
    name: 'button',
    type: 'registry:ui',
    dependencies: ['class-variance-authority'],
    files: [
      {
        path: 'registry/new-york-v4/ui/button.tsx',
        type: 'registry:ui',
        content:
          'import { cn } from "@/lib/utils"\nexport const Button = (p: any) => <button className={cn("b")} {...p} />',
      },
    ],
  },
  [shadcn.item('dialog-demo')]: {
    name: 'dialog-demo',
    type: 'registry:example',
    registryDependencies: ['dialog'],
    files: [
      {
        path: 'registry/new-york-v4/examples/dialog-demo.tsx',
        type: 'registry:example',
        content:
          'import { Dialog } from "@/registry/new-york-v4/ui/dialog"\nexport default function Demo() { return <Dialog /> }',
      },
    ],
  },
  [magic.item('marquee')]: {
    name: 'marquee',
    type: 'registry:ui',
    cssVars: { theme: { 'animate-marquee': 'marquee 30s linear infinite' } },
    css: {
      '@keyframes marquee': { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-100%)' } },
    },
    files: [
      {
        path: 'registry/magicui/marquee.tsx',
        type: 'registry:ui',
        content: 'export function Marquee() { return null }',
      },
    ],
  },
  [magic.item('marquee-demo')]: {
    name: 'marquee-demo',
    type: 'registry:example',
    registryDependencies: ['@magicui/marquee', '@other/thing'],
    files: [
      {
        path: 'registry/example/marquee-demo.tsx',
        type: 'registry:example',
        content: 'import { Marquee } from "@/registry/magicui/marquee"\nexport default () => <Marquee />',
      },
    ],
  },
}
const get = async (u: string) => {
  if (!(u in DB)) throw new Error('404 ' + u)
  return DB[u]
}

test('parseIndex: shadcn — компоненты и привязка примеров; React Bits — только TS-TW', () => {
  const items = parseIndex(shadcn, {
    items: [
      { name: 'button', type: 'registry:ui' },
      { name: 'button-demo', type: 'registry:example' },
      { name: 'alert', type: 'registry:ui', description: 'Сообщение' },
      { name: 'sidebar-01', type: 'registry:block' },
    ],
  })
  assert.deepEqual(
    items.map((i) => [i.name, i.demo]),
    [
      ['button', 'button-demo'],
      ['alert', undefined],
    ],
  )
  const rb = parseIndex(
    { id: 'reactbits' },
    { items: [{ name: 'A-TS-TW', title: 'A' }, { name: 'A-JS-CSS' }] },
  )
  assert.deepEqual(
    rb.map((i) => i.name),
    ['A-TS-TW'],
  )
  assert.deepEqual(parseIndex(shadcn, null), [])
  assert.deepEqual(parseIndex(shadcn, { items: [null, 5, { type: 'registry:ui' }] }), [])
})

test('filterUi и prettify', () => {
  const items = parseIndex(shadcn, {
    items: [
      { name: 'alert-dialog', type: 'registry:ui', description: 'Модальное окно' },
      { name: 'badge', type: 'registry:ui' },
    ],
  })
  assert.equal(filterUi(items, 'alert модаль').length, 1)
  assert.equal(filterUi(items, '').length, 2)
  assert.equal(prettify('alert-dialog'), 'Alert dialog')
  assert.equal(prettify('BlurText-TS-TW'), 'Blur Text')
})

test('resolveBundle: цепочка registryDependencies, догрузка необъявленных импортов, чужие реестры — заметка', async () => {
  const b = await resolveBundle(shadcn, 'dialog-demo', get)
  assert.deepEqual(b.files.map((x) => x.path.split('/').pop()).sort(), [
    'button.tsx',
    'dialog-demo.tsx',
    'dialog.tsx',
  ])
  assert.equal(b.entry, 'dialog-demo')
  const m = await resolveBundle(magic, 'marquee-demo', get)
  assert.ok(m.notes.some((n) => n.includes('@other/thing')))
  assert.equal(m.files.length, 2)
})

test('materialize: раскладка, относительные импорты, cn, зависимости', async () => {
  const b = await resolveBundle(shadcn, 'dialog-demo', get)
  const m = materialize(b)
  assert.deepEqual(Object.keys(m.files).sort(), [
    'src/components/dialog-demo.tsx',
    'src/components/ui/button.tsx',
    'src/components/ui/dialog.tsx',
    'src/lib/utils.ts',
  ])
  assert.match(m.files['src/components/ui/dialog.tsx'], /from "\.\/button"/)
  assert.match(m.files['src/components/ui/dialog.tsx'], /from "\.\.\/\.\.\/lib\/utils"/)
  assert.match(m.files['src/components/ui/button.tsx'], /from "\.\.\/\.\.\/lib\/utils"/)
  assert.match(m.files['src/components/dialog-demo.tsx'], /from "\.\/ui\/dialog"/)
  assert.deepEqual(Object.keys(m.deps).sort(), [
    'class-variance-authority',
    'clsx',
    'radix-ui',
    'tailwind-merge',
  ])
  assert.equal(m.entry, 'src/components/dialog-demo.tsx')
  assert.ok(!('cn' in m.deps))
  assert.deepEqual(m.notes, [])
})

test('materialize: существующий utils не перезаписывается; свой layout; одинаковые файлы помечаются', async () => {
  const b = await resolveBundle(shadcn, 'button', get)
  const ex = { 'app/lib/utils.ts': 'export const cn = () => ""', 'app/components/ui/x.tsx': '' }
  const lay = detectLayout(ex)
  assert.equal(lay.ui, 'app/components/ui')
  assert.equal(lay.lib, 'app/lib')
  const m = materialize(b, lay, ex)
  assert.ok(!('app/lib/utils.ts' in m.files), 'чужой utils не трогаем')
  assert.match(m.files['app/components/ui/button.tsx'], /from "\.\.\/\.\.\/lib\/utils"/)
  const again = materialize(b, lay, { ...ex, ...m.files })
  assert.deepEqual(again.same, ['app/components/ui/button.tsx'])
})

test('materialize: CSS и cssVars Magic UI превращаются в Tailwind v4', async () => {
  const m = materialize(await resolveBundle(magic, 'marquee', get))
  assert.match(m.css, /@theme inline \{\n  --animate-marquee: marquee 30s linear infinite;/)
  assert.match(m.css, /@keyframes marquee \{\n  from \{\n    transform: translateX\(0\);/)
  assert.equal(cssText([]), '')
})

test('resolveSpec: относительные, алиасы @/, cn', () => {
  const a = f('registry/x/ui/a.tsx', '')
  const b = f('registry/x/ui/b.tsx', '')
  const u = f('registry/x/lib/utils.ts', '', 'registry:lib')
  const all = [a, b, u]
  assert.equal(resolveSpec('./b', a, all), b)
  assert.equal(resolveSpec('@/registry/x/ui/b', a, all), b)
  assert.equal(resolveSpec('@/components/ui/b', a, all), b)
  assert.equal(resolveSpec('@/lib/utils', a, all), u)
  assert.equal(resolveSpec('cn', a, all), 'utils')
  assert.equal(resolveSpec('lodash', a, all), null)
  assert.equal(resolveSpec('@/hooks/none', a, all), null)
})

test('безопасность путей: target с .. и абсолютные не принимаются', () => {
  for (const bad of ['../x', 'a/../../b', '/etc/x', 'a\\b', 'C:/x', '.git/config'])
    assert.equal(safeRel(bad), false, bad)
  assert.ok(safeRel('src/components/ui/a.tsx'))
  const b = {
    entry: 'x',
    items: [],
    notes: [],
    files: [
      {
        path: 'a.tsx',
        content: 'export default 1',
        type: 'registry:ui',
        target: '../../evil.tsx',
        item: 'x',
      },
    ],
  }
  const m = materialize(b)
  assert.deepEqual(Object.keys(m.files), ['src/components/ui/a.tsx'])
})

test('customSource: список и одиночный компонент, плохие ссылки', () => {
  const l = customSource('https://example.com/r/registry.json')
  assert.equal(l.single, false)
  assert.equal(l.src.item('card'), 'https://example.com/r/card.json')
  assert.equal(customSource('https://example.com/r/card.json').single, true)
  assert.throws(() => customSource('ftp://x'))
  assert.throws(() => customSource('не ссылка'))
})

test('addDeps: добавляет недостающее, версии из реестра npm, не трогает существующее', async () => {
  const pkg = JSON.stringify({ name: 'a', dependencies: { react: '^18.0.0', clsx: '^2.0.0' } })
  const r = await addDeps(
    pkg,
    { clsx: 'latest', 'tailwind-merge': 'latest', motion: '^12.0.0' },
    { 'tw-animate-css': 'latest' },
    async (n) => (n === 'tailwind-merge' ? '^3.0.0' : null),
  )
  const j = JSON.parse(r.text)
  assert.deepEqual(r.added.sort(), ['motion', 'tailwind-merge', 'tw-animate-css'])
  assert.equal(j.dependencies.clsx, '^2.0.0')
  assert.equal(j.dependencies['tailwind-merge'], '^3.0.0')
  assert.equal(j.dependencies.motion, '^12.0.0')
  assert.equal(j.devDependencies['tw-animate-css'], 'latest')
  assert.equal((await addDeps('{oops', {}, {}, async () => null)).error, 'package.json повреждён')
})

test('mergeCss: дописывает один раз в CSS с Tailwind; без него — null', () => {
  const files = { 'src/index.css': '@import "tailwindcss";\nbody{}', 'src/other.css': 'a{}' }
  const r = mergeCss(files, 'marquee', '@keyframes k{}\n')!
  assert.equal(r.path, 'src/index.css')
  assert.ok(r.text.includes('/* tetra:ui marquee */') && r.text.includes('@keyframes k'))
  const twice = mergeCss({ ...files, [r.path]: r.text }, 'marquee', '@keyframes k{}\n')!
  assert.equal(twice.text, r.text)
  assert.equal(mergeCss({ 'a.css': 'a{}' }, 'x', 'y{}'), null)
  assert.equal(mergeCss(files, 'x', ' '), null)
})

test('среда запуска: валидный JS, без обратных кавычек, блок не ломает страницу', () => {
  assert.doesNotThrow(() => new Function(RUNTIME_JS))
  assert.ok(!RUNTIME_JS.includes('${'))
  const evil = {
    files: { 'a.tsx': 'export default () => "</script><script>alert(1)</script>"' },
    entry: 'a.tsx',
    deps: {},
    css: '/* </style> */',
  }
  const html = embedBlock(evil, 'abc', 'Ком"понент<x>')
  assert.equal(html.split('</script').length - 1, 1, 'закрывающий тег скрипта только один — наш')
  assert.ok(!html.includes('"Ком"понент'))
  assert.ok(html.includes('id="tf-ui-abc"'))
  const doc = previewDoc({ ...evil, dark: true })
  assert.ok(doc.includes('class="dark"') && doc.includes('id="root"'))
  assert.ok(!twCss('', false).includes('preflight.css'))
  assert.ok(twCss('', true).includes('preflight.css'))
})
