import test from 'node:test'
import assert from 'node:assert/strict'
import { PERSIST_VERSION, migrate, merge, partialize, stripVolatile } from './persistence'
import { initialPersisted, initialUI } from './defaults'
import type { Full } from './types'
import type { Message } from '../types'

const full = () => ({ ...initialPersisted(), ...initialUI() }) as unknown as Full

test('версия схемы не менялась без осознанного решения', () => {
  assert.equal(PERSIST_VERSION, 7)
})

test('migrate v4→v5: лишние демо-агенты сводятся к builder, данные остаются', () => {
  const old = {
    projects: [
      {
        chats: [
          {
            agents: [{ name: 'reviewer', sub: ['docs-writer', 'x'] }],
            messages: [{ agent: 'docs' }],
            creator: { kind: 'agent', name: 'builder-2' },
          },
        ],
        lanes: [
          { who: 'reviewer', subs: [] },
          { who: 'docs', subs: ['docs-writer-1', 'ok'] },
        ],
        tasks: [{ assignee: { kind: 'agent', name: 'reviewer' } }],
        memory: [{ by: 'docs' }],
      },
    ],
  }
  const r = migrate(old, 4) as unknown as typeof old
  const c = r.projects[0].chats[0]
  assert.equal(c.agents[0].name, 'builder')
  assert.deepEqual(c.agents[0].sub, []) // субагентов-персон больше нет
  assert.equal(c.messages[0].agent, 'builder')
  assert.equal(c.creator.name, 'builder')
  assert.deepEqual(
    r.projects[0].lanes.map((l) => l.who),
    ['builder'],
  )
  assert.deepEqual(r.projects[0].lanes[0].subs, ['ok'])
  assert.equal(r.projects[0].tasks[0].assignee.name, 'builder')
  assert.equal(r.projects[0].memory[0].by, 'builder')
})

test('migrate v5→v6: демо-проекты, вымышленные коллеги, провайдеры без ключа и имитации убраны, настоящее остаётся', () => {
  const real = {
    id: 'p1',
    name: 'мой',
    path: '~/dev/мой',
    members: ['me', 'el'],
    files: {
      'a.ts': 'x',
      'env/tetra.env.yaml': 'version: 1',
      '.tetra/pipelines/release.yaml': 'steps:\n  - name: A\n    run: tetra deploy --prod',
      '.tetra/pipelines/mine.yaml': 'steps:\n  - name: A\n    run: npm test',
    },
    env: { cpu: 4 },
    lanes: [
      { id: 'l1', who: 'builder', subs: [] },
      { id: 'lane-real', who: 'builder', subs: [] },
    ],
    chats: [
      {
        agents: [{ name: 'builder', sub: ['test-runner'] }],
        running: true,
        messages: [{ kind: 'perm' }, { kind: 'build' }, { kind: 'human', text: 'привет' }],
      },
    ],
    deploy: { auto: true, runs: [{ id: 'r', url: 'https://x.tetra.app', review: {} }] },
  }
  const old = {
    people: {
      me: { id: 'me', name: 'Никита', email: 'nikita@studio.dev' },
      el: { id: 'el' },
      ok: { id: 'ok' },
    },
    projects: [{ id: 'nebula', path: '~/dev/nebula-engine' }, real],
    providers: [
      { id: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: '' },
      { id: 'mine', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-1' },
      { id: 'router', baseUrl: 'https://api.internal.dev', apiKey: '' },
      { id: 'local', baseUrl: 'http://192.168.1.5:8000/v1', apiKey: '' },
    ],
    model: 'anthropic:claude-opus-4-6',
    lastProject: 'nebula',
  }
  const r = migrate(old, 5) as unknown as {
    people: Record<string, { name: string; email: string }>
    projects: (typeof real)[]
    providers: { id: string }[]
    model: string
    lastProject: string | null
  }
  assert.deepEqual(Object.keys(r.people).sort(), ['me', 'ok'])
  assert.equal(r.people.me.email, '')
  assert.deepEqual(
    r.projects.map((p) => p.id),
    ['p1'],
  )
  const p = r.projects[0]
  assert.equal(p.path, '')
  assert.deepEqual(p.members, ['me'])
  assert.deepEqual(Object.keys(p.files).sort(), ['.tetra/pipelines/mine.yaml', 'a.ts'])
  assert.equal('env' in p, false)
  assert.deepEqual(
    p.lanes.map((l) => l.id),
    ['lane-real'],
  )
  assert.deepEqual(
    p.chats[0].messages.map((m: { kind: string }) => m.kind),
    ['human'],
  )
  assert.deepEqual(p.chats[0].agents[0].sub, [])
  assert.equal(p.chats[0].running, false)
  assert.equal('url' in p.deploy.runs[0], false)
  assert.deepEqual(
    r.providers.map((x) => x.id),
    ['mine', 'local'],
  )
  assert.equal(r.model, '')
  assert.equal(r.lastProject, null)
})

test('migrate v5→v6 сохраняет абсолютный путь проекта и модель с ключом', () => {
  const r = migrate(
    {
      projects: [{ id: 'p2', path: 'C:\\work\\app', members: [], files: {}, lanes: [], chats: [] }],
      providers: [{ id: 'k', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk', models: [] }],
      model: 'k:gpt',
    },
    5,
  ) as unknown as { projects: { path: string }[]; model: string }
  assert.equal(r.projects[0].path, 'C:\\work\\app')
  assert.equal(r.model, 'k:gpt')
})

test('migrate из неизвестной версии не падает и даёт начальное состояние', () => {
  const r = migrate({ junk: 1 }, 1) as unknown as { projects: unknown[] }
  assert.ok(Array.isArray(r.projects))
})

test('merge: без входа открывается экран входа, на удалённый проект — лаунчер', () => {
  const cur = full()
  const a = merge({ authed: false, screen: 'workspace' }, cur)
  assert.equal(a.screen, 'auth')
  const b = merge({ authed: true, screen: 'workspace', projectId: 'нет-такого' }, cur)
  assert.equal(b.screen, 'launcher')
})

test('partialize не сохраняет временное (тосты, модалки, палитру)', () => {
  const s = { ...full(), toasts: [{ id: 't' }], palette: true } as unknown as Full
  const p = partialize(s) as unknown as Record<string, unknown>
  assert.ok(!('toasts' in p) && !('palette' in p) && !('modal' in p))
  assert.ok('projects' in p && 'settings' in p)
})

test('stripVolatile: прерванный стрим становится законченным сообщением', () => {
  const m = {
    kind: 'agent',
    streaming: true,
    text: '',
    parts: [{ k: 'cmd', state: 'running' }],
  } as unknown as Message
  const r = stripVolatile(m) as unknown as {
    streaming: boolean
    text: string
    parts: Array<{ state: string }>
  }
  assert.equal(r.streaming, false)
  assert.ok(r.text.includes('прерван'))
  assert.equal(r.parts[0].state, 'error')
})

test('сохранение: версии пакуются разницей и собираются обратно через merge', () => {
  const files = { 'a.txt': 'x'.repeat(5000), 'b.txt': '1' }
  const mk = (n: number, b: string) => ({
    n,
    title: 't' + n,
    at: n,
    by: 'human' as const,
    author: 'me',
    tag: 'build' as const,
    feats: [],
    changes: [],
    fixes: [],
    details: [],
    snapshot: { ...files, 'b.txt': b },
  })
  const cur = full()
  const base = initialPersisted().projects[0] ?? ({ id: 'p', versions: [], chats: [], files: {} } as never)
  cur.projects = [{ ...base, id: 'p1', chats: [], versions: [mk(1, '1'), mk(2, '2'), mk(3, '3')] }] as never
  const saved = JSON.parse(JSON.stringify(partialize(cur)))
  assert.ok(JSON.stringify(saved.projects[0].versions).length < 6500)
  const back = merge(saved, full())
  assert.deepEqual(back.projects[0].versions, cur.projects[0].versions)
})
test('migrate: данные схемы 6 принимаются как есть, из будущего — сбрасываются', () => {
  const old = { projects: [{ id: 'x', versions: [] }], people: {} }
  assert.equal(migrate(old, 6), old as never)
  assert.deepEqual((migrate(old, 8) as unknown as { projects: unknown[] }).projects, [])
})
