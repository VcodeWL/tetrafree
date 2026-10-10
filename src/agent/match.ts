/* /match — подгонка вёрстки под скриншот. Приложи эталон и напиши `/match`: цикл снимает страницу проекта настоящим
   браузером, считает сходство с эталоном, показывает агенту эталон, текущий вид и карту различий — и повторяет,
   пока страница не совпадёт (или прогресс не остановится / не нажмут «Стоп»). */
import { bShot } from '../lib/backend'
import { compareImages, shrinkForModel, pct } from '../lib/imgdiff'
import { shotTarget } from './webtools'
import { loopNote, type Hooks } from './loop'
import { LOOP_DONE } from './slash'

export interface MatchSpec {
  /** нужное сходство, 0.5…0.999 */
  threshold: number
  max: number
  path?: string
  url?: string
  notes: string
  error?: string
}
export const MATCH_DEFAULT = 0.96
export const MATCH_MAX = 60

/** `/match 97% x20 index.html заметки`, `/match http://localhost:5173/ …`; без числа проходов — до совпадения */
export function parseMatch(args: string): MatchSpec {
  let rest = args.trim()
  const spec: MatchSpec = { threshold: MATCH_DEFAULT, max: 0, notes: '' }
  for (let guard = 0; guard < 6 && rest; guard++) {
    let m: RegExpMatchArray | null
    if ((m = rest.match(/^(?:порог\s+)?(\d{2,3}(?:[.,]\d)?)\s?%\s*/i))) {
      const v = parseFloat(m[1].replace(',', '.')) / 100
      if (v < 0.5 || v > 0.999) return { ...spec, error: 'Порог сходства — от 50% до 99,9%' }
      spec.threshold = v
    } else if ((m = rest.match(/^(?:x|х|×)\s?(\d{1,3})(?=\s|$)\s*/i))) spec.max = Math.min(MATCH_MAX, +m[1])
    else if ((m = rest.match(/^(https?:\/\/\S+)\s*/i))) spec.url = m[1]
    else if ((m = rest.match(/^([\w./@-]+\.html?)(?=\s|$)\s*/i))) spec.path = m[1]
    else break
    rest = rest.slice(m[0].length)
  }
  spec.notes = rest
  return spec
}

const ROOTS = ['index.html', 'site/index.html', 'public/index.html', 'src/index.html', 'dist/index.html']

/** Какая страница считается «результатом», если пользователь не назвал файл */
export function defaultPage(files: Record<string, string>): string {
  return (
    ROOTS.find((r) => r in files) ||
    Object.keys(files).find((f) => /\.html?$/.test(f) && !f.includes('node_modules')) ||
    ''
  )
}

async function size(url: string) {
  const b = await createImageBitmap(await (await fetch(url)).blob())
  const r = { w: b.width, h: b.height }
  b.close()
  return r
}

export interface MatchCtx {
  ref: string
  spec: MatchSpec
  project: () => { name: string; files: Record<string, string> } | undefined
}

export function matchHooks(c: MatchCtx): Hooks {
  const scores: number[] = []
  return {
    title: 'Подгонка под скриншот',
    async before(n, st) {
      const p = c.project()
      if (!p) return { stop: 'проект закрыт' }
      const page = c.spec.path || (c.spec.url ? '' : defaultPage(p.files))
      const t = shotTarget(p, { path: page, url: c.spec.url })
      const { w, h } = await size(c.ref)
      const W = Math.min(2560, Math.max(320, w)),
        H = Math.min(6000, Math.max(240, h))
      let shot: string
      try {
        shot = (await bShot(t.url, W, H)).image
      } catch (e) {
        return { stop: 'не удалось снять страницу — ' + (e as Error).message }
      }
      const d = await compareImages(c.ref, shot)
      const prev = scores[scores.length - 1]
      scores.push(d.score)
      loopNote(st.chatId, `сходство ${pct(d.score)} из ${pct(c.spec.threshold)}`)
      if (d.score >= c.spec.threshold)
        return { stop: `совпало на ${pct(d.score)} (цель ${pct(c.spec.threshold)})` }
      const best = Math.max(...scores)
      if (scores.length >= 7 && best <= Math.max(...scores.slice(0, -4)) + 0.003)
        return {
          stop: `прогресс остановился на ${pct(best)} — дальше нужен человек (цель ${pct(c.spec.threshold)})`,
        }
      const exists = !page || page in p.files
      const sizeNote =
        Math.abs(d.cur.h - d.ref.h) > 0 && d.cur.h !== d.ref.h
          ? `Размер снимка ${d.cur.w}×${d.cur.h}, эталона ${d.ref.w}×${d.ref.h}.`
          : ''
      const extra = `[/match · проход ${n}] Задача: страница ${t.title} должна выглядеть ТОЧЬ-В-ТОЧЬ как эталон.

К сообщению приложены 3 картинки по порядку: 1) ЭТАЛОН — как должно быть; 2) ТЕКУЩИЙ результат (снимок окна ${W}×${H}); 3) КАРТА РАЗЛИЧИЙ — красным пиксели, которые не совпадают.
Сходство сейчас: ${pct(d.score)} (цель — не меньше ${pct(c.spec.threshold)})${prev !== undefined ? `; на прошлом проходе было ${pct(prev)}${d.score < prev - 0.002 ? ' — стало ХУЖЕ, исправь или откати неудачную правку' : ''}` : ''}.
${d.regions.length ? 'Сильнее всего отличаются: ' + d.regions.map((r) => `${r.name} (${pct(r.diff)})`).join('; ') + '.' : ''} ${sizeNote}
${exists ? '' : `Файла ${page} в проекте ещё нет — создай страницу с нуля по эталону (все тексты, блоки, цвета).\n`}
Как работать:
- Сравни картинки внимательно: сетку и размеры блоков, отступы, цвета (подбирай hex по эталону), шрифты и начертание, скругления, тени, иконки, тексты.
- Правь настоящий HTML/CSS (<edit>/<write>): только то, что отличается, по самым заметным местам карты различий; уже совпавшее не ломай. Вёрстка должна совпасть именно на ширине ${W}px.
- Нельзя вставлять эталон картинкой (<img>/background) — только честная вёрстка.
- После правок можешь сам посмотреть результат: <shot path="${page || 'index.html'}" width="${W}" height="${H}" />.
- Если различий не осталось — напиши отдельной строкой ${LOOP_DONE}; но решает цифра: цикл остановится сам при сходстве ≥ ${pct(c.spec.threshold)}.${c.spec.notes ? '\nПожелания пользователя: ' + c.spec.notes : ''}`
      const imgs = [
        await shrinkForModel(c.ref, 1100),
        await shrinkForModel(shot, 1100),
        await shrinkForModel(d.heat, 900),
      ]
      return {
        extra,
        imgs,
        silent: `🎯 Подгонка · проход ${n} · сходство ${pct(d.score)} из ${pct(c.spec.threshold)}`,
      }
    },
  }
}
