/* Exact per-operation CAS evidence, kept with the card across reloads. Old cards without
   evidence require confirmation. No hashes: truncated text cannot prove equality. */
import type { ID, Part } from '../types'
import { fileOf, expandDelete, putFile } from './projectfs'
import { uid } from '../lib/util'

export type FilePart = Extract<Part, { k: 'file' }>
export type FileImage = Record<string, string | null>
export interface FileGuard {
  before: FileImage
  after: FileImage
}
export type GuardedFile = FilePart & { agentGuard?: FileGuard }
export function image(pid: ID, paths: string[]): FileImage {
  return Object.fromEntries(paths.map((p) => [p, fileOf(pid, p) ?? null]))
}
export function pathsOf(pid: ID, f: FilePart): string[] {
  return [
    ...new Set([f.path, ...(f.to ? [f.to] : []), ...(f.op === 'delete' ? expandDelete(pid, f.path) : [])]),
  ]
}
export function sameImage(a: FileImage, b: FileImage): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => k in b && a[k] === b[k])
}
export function currentImage(pid: ID, f: FilePart, expected?: FileImage): FileImage {
  return image(pid, [...new Set([...pathsOf(pid, f), ...Object.keys(expected || {})])])
}
/** Store the displaced state BEFORE a forced destructive commit. Failure aborts commit. */
export function recover(pid: ID, files: FileImage): string {
  let path: string
  do {
    path = `.tetra/recovery/${uid('files')}.json`
  } while (fileOf(pid, path) !== undefined)
  const content = JSON.stringify({ at: Date.now(), files }, null, 2)
  putFile(pid, path, content)
  if (fileOf(pid, path) !== content) throw new Error('Не удалось сохранить копию для восстановления')
  return path
}
