/* Что видит модель: история чата и системная инструкция агента */
import type { Attachment, ID, Message, Project } from '../types'
import { AGENTS } from '../data/seed'
import type { ChatMsg } from './llm'
import { projectRules } from './rules'
import { skillsIndex } from './slash'

/* ------------------------------------------------------------------ контекст для модели */

export function history(all: Message[], exclude: ID): ChatMsg[] {
  const out: ChatMsg[] = []
  /* «/clear»: всё, что было до последней отметки сброса, модель не видит */
  const cut = all.map((m) => m.kind === 'sys' && m.reset).lastIndexOf(true)
  const msgs = cut >= 0 ? all.slice(cut + 1) : all
  for (const m of msgs) {
    if (m.id === exclude) continue
    if (m.kind === 'human')
      out.push({
        role: 'user',
        content:
          m.text +
          (m.attachments?.length ? `\n[вложения: ${m.attachments.map((a) => a.name).join(', ')}]` : ''),
      })
    else if (m.kind === 'agent' && !m.error) {
      const body = m.parts?.length
        ? m.parts
            .map((p) =>
              p.k === 'text'
                ? p.text
                : p.k === 'file'
                  ? `[${p.op === 'delete' ? 'удалён' : p.op === 'create' ? 'создан' : p.op === 'rename' ? 'переименован' : 'изменён'} ${p.path}${p.state === 'rejected' ? ' — отклонено пользователем' : p.state === 'reverted' ? ' — отменено' : p.state === 'error' ? ' — ошибка' : ''}]`
                  : p.k === 'cmd'
                    ? `[команда: ${p.cmd}]`
                    : '',
            )
            .filter(Boolean)
            .join('\n')
        : m.text
      if (body) out.push({ role: 'assistant', content: body })
    }
  }
  while (out.length && out[0].role !== 'user') out.shift()
  const merged: ChatMsg[] = []
  for (const m of out.slice(-20)) {
    const l = merged[merged.length - 1]
    if (l && l.role === m.role) l.content += '\n\n' + m.content
    else merged.push({ ...m })
  }
  return merged
}

export function systemPrompt(p: Project, agent: string, att: Attachment[]) {
  let budget = 40000
  const names = Object.keys(p.files)
  const files = names
    .map((k) => {
      const v = p.files[k]
      const cap = Math.min(v.length, 8000, Math.max(0, budget))
      if (cap <= 0) return `### ${k} (${v.length} симв., не показан — используй <read path="${k}" />)`
      budget -= cap
      return `### ${k}\n${v.slice(0, cap)}${cap < v.length ? `\n…(показано ${cap} из ${v.length} симв.; полный файл — <read path="${k}" />)` : ''}`
    })
    .join('\n\n')
  const rules = projectRules(p.files)
  const skills = skillsIndex(p.files)
  return `Ты — агент «${agent}» (${AGENTS[agent]?.role || 'помощник разработчика'}) в TetraFree, среде совместной разработки людей и ИИ-агентов.
Проект: ${p.name} — ${p.desc}
Отвечай по-русски, коротко и по делу.

КАК РАБОТАТЬ С ФАЙЛАМИ. Любое изменение проекта делай ТОЛЬКО этими тегами — они применяются сразу, пока ты пишешь, и пользователь видит карточки «создаёт / редактирует / удаляет»:
<write path="путь/файл.ext">полное новое содержимое файла</write>   — создать или полностью перезаписать
<edit path="путь/файл.ext"><find>точный фрагмент из файла</find><replace>на что заменить</replace></edit>   — точечная правка (можно несколько пар find/replace подряд); find должен встречаться в файле ровно в таком виде
<delete path="путь/файл.ext" />   — удалить файл (путь папки удаляет всё внутри). Удалять можно ЛЮБЫЕ файлы проекта, в том числе созданные ранее.
<rename from="старый" to="новый" />
<read path="путь" />   — прочитать файл целиком, если он показан не полностью
<run>команда</run>   — выполнить команду в папке проекта; её вывод придёт тебе следующим сообщением

ПРАВИЛА.
1. Никогда не выводи код или содержимое файлов в обычном тексте и в блоках \`\`\` — только внутри <write>/<edit>. В чате пользователь должен видеть лишь короткий текст.
2. Структура ответа: 1–2 предложения о том, что собираешься сделать → теги действий → 1–3 предложения итога. Без вступлений и повторов.
3. Для небольших правок используй <edit>, для новых файлов и крупных переделок — <write>. Не переписывай файл целиком ради одной строки.
4. Пути — относительные от корня проекта, например site/index.html, source/main.ts, docs/README.md.
5. Не придумывай содержимого файлов, которых не видел: если файл показан не целиком — сначала <read>.
6. Если просьба неясна или опасна — сначала спроси словами, не делай правок.
${att.length ? 'Вложения пользователя: ' + att.map((a) => a.name).join(', ') + '\n' : ''}
${skills ? 'НАВЫКИ ПРОЕКТА (готовые инструкции; если задача подходит под описание — сначала прочитай SKILL.md и следуй ему):\n' + skills + '\n\n' : ''}${rules ? 'ПРАВИЛА И ИНСТРУКЦИИ ПРОЕКТА (задала команда, соблюдай их):\n' + rules + '\n\n' : ''}Общая память проекта (решения из всех чатов):
${
  p.memory
    .slice(0, 20)
    .map((m) => `- ${m.text} (${m.by}${m.chat ? ', чат «' + m.chat + '»' : ''})`)
    .join('\n') || '—'
}

Дерево проекта (${names.length} файлов): ${names.join(', ') || 'пусто'}

Содержимое файлов:
${files || '(файлов нет)'}`
}
