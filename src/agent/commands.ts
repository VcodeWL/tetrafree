/* Исполнение слэш-команд из поля ввода. Возвращает, что делать дальше композеру. */
import type { ID, Attachment } from '../types'
import { useStore, getChat, toast } from '../store'
import { uid } from '../lib/util'
import { sendMessage, stopTurn, isRunning, resolveModel } from './engine'
import { backendOnline } from '../lib/backend'
import { enqueue, clearQueue, useQueue } from './queue'
import { loopStart, loopStop, loopActive, useLoops } from './loop'
import { parseMatch, matchHooks } from './match'
import { parseAuto, autoHooks, AUTOPILOT_FILE, FOCUS } from './autopilot'
import {
  BUILTINS,
  parseSlash,
  parseLoop,
  listCustom,
  listSkills,
  expandTemplate,
  fmtGap,
  type Skill,
} from './slash'

const S = () => useStore.getState()
const say = (chatId: ID, text: string) =>
  S().pushMsg(chatId, { id: uid('m'), kind: 'sys', text, at: Date.now() })

const NEED_ARGS = new Set(['plan', 'explain', 'memory', 'skill'])
const CAP = 20000

export function helpText(files: Record<string, string>): string {
  const b = BUILTINS.map((c) => `**/${c.name}**${c.hint ? ' ' + c.hint : ''} — ${c.desc}`)
  const cu = listCustom(files).map(
    (c) => `**/${c.name}**${c.hint ? ' ' + c.hint : ''} — ${c.description || 'своя команда'}`,
  )
  const sk = listSkills(files).map((c) => `**/${c.name}** — ${c.description || 'навык'}`)
  return [
    'Команды',
    ...b,
    ...(cu.length ? ['', 'Свои команды проекта (.tetra/commands)', ...cu] : []),
    ...(sk.length ? ['', 'Навыки проекта (.tetra/skills)', ...sk] : []),
    '',
    'Как добавить свою команду или навык — в docs/SLASH.md репозитория TetraFree; готовые наборы — в «Расширения».',
  ].join('\n')
}

function skillExtra(s: Skill, args: string) {
  return (
    `Применяй навык «${s.name}» (${s.path}). Его инструкция:\n\n${s.body.trim().slice(0, CAP)}\n\n` +
    `Задача пользователя: ${args || '(не уточнена — выполни то, что описано в навыке, или спроси)'}\n` +
    `Файлы навыка лежат в ${s.dir}/ — читай нужные через <read>.`
  )
}

export type Outcome = { kind: 'none' } | { kind: 'done'; keep?: boolean } | { kind: 'send'; extra: string }

/** Разбирает «/…» и либо исполняет команду сразу (done), либо готовит развёрнутый запрос агенту (send). */
export function resolveSlash(chatId: ID, text: string, atts: Attachment[] = []): Outcome {
  const cmd = parseSlash(text)
  if (!cmd) return { kind: 'none' }
  const st = S()
  const pid = st.projectId
  const files = st.projects.find((p) => p.id === pid)?.files || {}
  const { name, args } = cmd
  const done: Outcome = { kind: 'done' }
  const bi = BUILTINS.find((b) => b.name === name)
  if (bi) {
    if (NEED_ARGS.has(name) && !args) {
      say(chatId, `Допиши, что именно: **/${name}** ${bi.hint}`)
      return done
    }
    switch (name) {
      case 'stop': {
        const had = isRunning(chatId) || loopActive(chatId)
        clearQueue(chatId)
        stopTurn(chatId)
        say(
          chatId,
          had ? 'Остановлено: агент и цикл /loop, очередь сообщений очищена' : 'Сейчас нечего останавливать',
        )
        return done
      }
      case 'help':
        say(chatId, helpText(files))
        return done
      case 'clear':
        S().pushMsg(chatId, {
          id: uid('m'),
          kind: 'sys',
          text: 'Контекст очищен — агент начинает с чистого листа. Переписка выше осталась на экране, но модель её больше не видит',
          at: Date.now(),
          reset: true,
        })
        return done
      case 'memory': {
        if (!pid) return done
        const chat = getChat(pid, chatId)
        S().remember({ text: args.slice(0, 500), by: 'me', kind: 'decision', chatId, chat: chat?.title }, pid)
        say(chatId, 'Запомнил в общей памяти проекта — агенты будут это учитывать')
        return done
      }
      case 'model': {
        const r = resolveModel()
        say(
          chatId,
          r.live
            ? `Сейчас отвечает **${r.label}**. Выбрать другую — в окне «Провайдеры»`
            : 'Модель не подключена — добавь провайдера и ключ',
        )
        S().openModal({ type: 'settings', section: 'providers' })
        return done
      }
      case 'skills': {
        const sk = listSkills(files)
        say(
          chatId,
          sk.length
            ? 'Навыки проекта\n' +
                sk.map((k) => `**/${k.name}** — ${k.description || '—'} (${k.path})`).join('\n')
            : 'В проекте нет навыков. Положи `SKILL.md` в `.tetra/skills/<имя>/` или поставь готовые из «Расширения»',
        )
        return done
      }
      case 'skill': {
        const [n, ...rest] = args.split(/\s+/)
        const k = listSkills(files).find((x) => x.name === n)
        if (!k) {
          say(chatId, `Нет навыка «${n}». Список — /skills`)
          return done
        }
        return { kind: 'send', extra: skillExtra(k, rest.join(' ')) }
      }
      case 'loop': {
        if (/^(stop|стоп|off)$/i.test(args)) {
          say(chatId, loopStop(chatId) ? 'Цикл остановлен' : 'Цикл не запущен')
          return done
        }
        if (loopActive(chatId)) {
          toast({ title: 'Цикл уже идёт', desc: '/loop stop — остановить', icon: 'warn' })
          return done
        }
        if (isRunning(chatId) || (useQueue.getState().q[chatId] || []).length) {
          toast({ title: 'Агент ещё работает', desc: 'Запусти /loop, когда он закончит', icon: 'warn' })
          return done
        }
        const spec = parseLoop(args)
        if (spec.error) {
          say(chatId, spec.error)
          return done
        }
        if (!pid) return done
        void loopStart(chatId, pid, spec, text.trim()).then((ok) => {
          if (ok && !S().settings.budget)
            say(
              chatId,
              `↻ Цикл запущен${spec.max ? `: ${spec.max} проходов` : ' без лимита проходов'}, пауза ${fmtGap(spec.gap)}. Лимит расходов не задан — для платной модели задай его в «Расходы». Остановить: «Стоп» или /stop`,
            )
        })
        return done
      }
      case 'match':
      case 'autopilot': {
        if (!pid) return done
        const keep: Outcome = { kind: 'done', keep: true }
        if (loopActive(chatId)) {
          toast({ title: 'Цикл уже идёт', desc: '/stop — остановить', icon: 'warn' })
          return keep
        }
        if (isRunning(chatId) || (useQueue.getState().q[chatId] || []).length) {
          toast({ title: 'Агент ещё работает', desc: `Запусти /${name}, когда он закончит`, icon: 'warn' })
          return keep
        }
        if (!backendOnline()) {
          say(
            chatId,
            `/${name} нужен локальный сервер TetraFree (в десктопной сборке он запускается сам, в браузере — npm run server)`,
          )
          return done
        }
        const tier = getChat(pid, chatId)?.agents[0]?.tier
        const proj = () => S().projects.find((p) => p.id === pid)
        if (name === 'match') {
          const ref = atts.find((a) => a.url && a.mime.startsWith('image/'))?.url
          if (!ref) {
            say(
              chatId,
              'Приложи скриншот-эталон (скрепка или вставка из буфера) и напиши `/match` ещё раз. Можно: `/match 97% x20 index.html`',
            )
            return keep
          }
          const spec = parseMatch(args)
          if (spec.error) {
            say(chatId, spec.error)
            return keep
          }
          const task = `${spec.url || spec.path || 'страница проекта'} → сходство ≥ ${Math.round(spec.threshold * 1000) / 10}%`
          void loopStart(
            chatId,
            pid,
            { task, max: spec.max, gap: 2000 },
            text.trim() || '/match',
            matchHooks({ ref, spec, project: () => proj() }),
            'match',
          ).then((ok) => {
            if (ok && tier === 'Эскалация')
              say(
                chatId,
                'Агент на уровне «Эскалация»: каждая правка ждёт твоего решения, и подгонка будет стоять. Для /match лучше «Уведомить»',
              )
          })
          return done
        }
        const spec = parseAuto(args)
        void loopStart(
          chatId,
          pid,
          {
            task:
              spec.focus.length === FOCUS.length
                ? 'сам выбирает улучшения'
                : spec.focus.map((f) => f.title).join(', '),
            max: spec.max,
            gap: spec.gap,
          },
          text.trim() || '/autopilot',
          autoHooks(spec, () => proj()?.files[AUTOPILOT_FILE] || ''),
          'auto',
        ).then((ok) => {
          if (!ok) return
          say(
            chatId,
            `🧭 Автопилот включён: агент сам выбирает улучшения (${spec.focus.map((f) => f.title.toLowerCase()).join(', ')}) и ведёт журнал в \`${AUTOPILOT_FILE}\`. Каждая правка — отдельная версия, её можно откатить. ${tier === 'Эскалация' ? 'Агент на уровне «Эскалация»: правки будут ждать твоего решения — для автопилота лучше «Уведомить». ' : ''}${S().settings.budget ? '' : 'Лимит расходов не задан — для платной модели задай его в «Расходы». '}Остановить: «Стоп» или /stop`,
          )
        })
        return done
      }
    }
    if (bi.prompt) return { kind: 'send', extra: expandTemplate(bi.prompt, args) }
    return done
  }
  const cu = listCustom(files).find((c) => c.name === name)
  if (cu) return { kind: 'send', extra: expandTemplate(cu.body.trim().slice(0, CAP), args) }
  const sk = listSkills(files).find((k) => k.name === name)
  if (sk) return { kind: 'send', extra: skillExtra(sk, args) }
  say(
    chatId,
    `Нет команды **/${name}**. Список — /help. Если это не команда, а текст, начни сообщение с другого символа`,
  )
  return done
}

/** Отправка из композера: команда → её исполнение, иначе обычное сообщение (в очередь, если агент занят) */
export function submit(chatId: ID, text: string, atts: Attachment[], running: boolean): 'keep' | 'clear' {
  const r = resolveSlash(chatId, text, atts)
  if (r.kind === 'done') {
    if (r.keep) return 'keep'
    S().setDraft(chatId, '')
    return 'clear'
  }
  const extra = r.kind === 'send' ? r.extra : ''
  if (running) {
    enqueue(chatId, text.trim(), atts, extra)
    S().setDraft(chatId, '')
  } else sendMessage(chatId, text, atts, extra)
  return 'clear'
}

export { useLoops }
