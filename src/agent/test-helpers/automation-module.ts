/* Unit/component loader: actual control/journal/loop/CI modules, mock store, sync and exec only. */
import { build } from 'esbuild'
import { writeFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function automationModules(schedulers = false) {
  const root = resolve('src')
  const mocks: Record<string, string> = {
    [join(root, 'store')]:
      `export const useStore = {getState:()=>globalThis.__automationHarness.state,subscribe:(fn)=>globalThis.__automationHarness.subscribe(fn)}; export const toast = ()=>{};`,
    [join(root, 'lib/backend')]:
      `export const backendOnline=()=>true; export const bExec=(...args)=>globalThis.__automationHarness.exec(...args);`,
    [join(root, 'lib/sync')]:
      `export const reconcile=(...args)=>globalThis.__automationHarness.reconcile(...args);`,
  }
  const result = await build({
    stdin: {
      contents: `export * from './src/agent/automationControl'; export * from './src/agent/automationJournal'; ${schedulers ? "export * from './src/agent/loop'; export * from './src/agent/ci';" : ''}`,
      resolveDir: resolve('.'),
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    plugins: [
      {
        name: 'automation-unit-dependencies',
        setup(b) {
          b.onResolve({ filter: /^\./ }, (a) => {
            const path = resolve(a.resolveDir, a.path).replace(/\.ts$/, '')
            if (mocks[path]) return { path, namespace: 'mock' }
          })
          b.onLoad({ filter: /.*/, namespace: 'mock' }, (a) => ({ contents: mocks[a.path], loader: 'js' }))
        },
      },
    ],
  })
  const file = resolve(`src/agent/test-helpers/.automation-unit-${crypto.randomUUID()}.mjs`)
  await writeFile(file, result.outputFiles[0].contents)
  try {
    return await import(pathToFileURL(file).href)
  } finally {
    await rm(file, { force: true })
  }
}
