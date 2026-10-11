/* Хранилище состояния в IndexedDB. У localStorage потолок около 5 МБ на всё приложение; IndexedDB ограничен только
   диском (сотни МБ и больше). Значение пишется как есть (structured clone), без JSON-строки.
   Если IndexedDB недоступен (закрытый режим, повреждённая база) — вызывающий код откатывается на localStorage. */
const DB = 'tetrafree-db'
const ST = 'kv'

let opening: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const rq = indexedDB.open(DB, 1)
      rq.onupgradeneeded = () => {
        if (!rq.result.objectStoreNames.contains(ST)) rq.result.createObjectStore(ST)
      }
      rq.onsuccess = () => {
        const db = rq.result
        db.onversionchange = () => db.close()
        resolve(db)
      }
      rq.onerror = () => resolve(null)
      rq.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}

/** true, если IndexedDB открылся и им можно пользоваться */
export async function idbAvailable(): Promise<boolean> {
  return (await open()) !== null
}

function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        if (!db) return reject(new Error('IndexedDB недоступен'))
        try {
          const tx = db.transaction(ST, mode)
          const rq = f(tx.objectStore(ST))
          tx.oncomplete = () => resolve(rq.result)
          tx.onerror = () => reject(tx.error || new Error('Ошибка IndexedDB'))
          tx.onabort = () => reject(tx.error || new Error('Транзакция IndexedDB прервана'))
        } catch (e) {
          reject(e)
        }
      }),
  )
}

export const idbGet = <T = unknown>(k: string) => run<T>('readonly', (s) => s.get(k))
export const idbSet = (k: string, v: unknown) => run('readwrite', (s) => s.put(v, k)).then(() => undefined)
export const idbDel = (k: string) => run('readwrite', (s) => s.delete(k)).then(() => undefined)
