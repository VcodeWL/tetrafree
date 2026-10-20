/* Превью получает отдельный origin и короткоживущую capability, не токен аккаунта. */
import { api } from './account'
import { backendOnline, type ProjRef } from './backend'
import { isAbsPath } from './paths'
import { openExternal } from './desktop'
import { useStore } from '../store'

export async function getPreviewUrl(p: ProjRef, path = ''): Promise<string> {
  if (!backendOnline()) throw new Error('Для превью нужен локальный сервер и вход в аккаунт')
  const r = await api<{ url: string; expiresAt: number }>('POST', '/api/preview', {
    id: p.id,
    name: p.name,
    ...(isAbsPath(p.path) ? { folder: p.path } : {}),
    path,
  })
  const u = new URL(r.url)
  if (
    u.protocol !== 'http:' ||
    u.hostname !== '127.0.0.1' ||
    !/^\/p\/[0-9a-f]{32}\//.test(u.pathname) ||
    !(r.expiresAt > Date.now())
  )
    throw new Error('Сервер вернул неверный или истёкший адрес превью')
  return u.href
}
export async function openProjectPreview(p: ProjRef, path = '') {
  try {
    await openExternal(await getPreviewUrl(p, path))
  } catch (e) {
    useStore.getState().toast({
      title: 'Не удалось открыть превью',
      desc: e instanceof Error ? e.message : String(e),
      icon: 'warn',
      tone: 'err',
    })
  }
}

/** Исторический HTML исполняется только в opaque iframe, никогда в origin приложения. */
export function snapshotPreviewDocument(html: string): string {
  const attr = html.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return (
    '<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Сохранённая версия</title><style>html,body,iframe{margin:0;border:0;width:100%;height:100%}</style><iframe sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" srcdoc="' +
    attr +
    '"></iframe>'
  )
}
