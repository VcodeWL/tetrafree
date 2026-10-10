/* Исполнение слэш-команд из поля ввода. Возвращает, что делать дальше композеру. */
import type { ID, Attachment } from '../types'
import { useStore, getChat, toast } from '../store'
import { uid } from '../lib/util'
import { sendMessage, stopTurn, isRunning, resolveModel } from './engine'
import { enqueue, clearQueue, useQueue } from './queue'
import { loopStart, loopStop, loopActive, useLoops } from './loop'
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

export type Outcome = { kind: 'none' } | { kind: 'done' } | { kind: 'send'; extra: string }

/** Разбирает «/…» и либо исполняет команду сразу (done), либо готовит развёрнутый запрос агенту (send). */
export function resolveSlash(chatId: ID, text: string): Outcome {
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
        if (loopStart(chatId, pid, spec, text.trim()) && !S().settings.budget)
          say(
            chatId,
            `↻ Цикл запущен${spec.max ? `: ${spec.max} проходов` : ' без лимита проходов'}, пауза ${fmtGap(spec.gap)}. Лимит расходов не задан — для платной модели задай его в «Расходы». Остановить: «Стоп» или /stop`,
          )
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
export function submit(chatId: ID, text: string, atts: Attachment[], running: boolean): boolean {
  const r = resolveSlash(chatId, text)
  if (r.kind === 'done') {
    S().setDraft(chatId, '')
    return true
  }
  const extra = r.kind === 'send' ? r.extra : ''
  if (running) {
    enqueue(chatId, text.trim(), atts, extra)
    S().setDraft(chatId, '')
  } else sendMessage(chatId, text, atts, extra)
  return false
}

export { useLoops }
