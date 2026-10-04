import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-expect-error — JS-модуль без типов
import { tetraMiddleware } from './server/tetra-server.mjs'

/* Локальный бэкенд TetraFree встроен в dev/preview-сервер: /api/* и /preview/* */
const tetraBackend = () => ({
  name: 'tetra-backend',
  configureServer(server: { middlewares: { use: (m: unknown) => void } }) { server.middlewares.use(tetraMiddleware()) },
  configurePreviewServer(server: { middlewares: { use: (m: unknown) => void } }) { server.middlewares.use(tetraMiddleware()) },
})

// Tauri ожидает фиксированный порт и не должен очищать экран, чтобы были видны ошибки Rust
export default defineConfig({
  plugins: [react(), tetraBackend()],
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync('./package.json', 'utf8')).version) },
  clearScreen: false,
  server: { host: '127.0.0.1', port: 3000, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'es2020',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'zustand', 'immer'],
          motion: ['framer-motion'],
          xterm: ['@xterm/xterm', '@xterm/addon-fit'],
        },
      },
    },
  },
})
