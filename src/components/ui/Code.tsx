import { memo, useState } from 'react'
import { tokenize } from '../../lib/highlight'
import { copyText, langOf } from '../../lib/util'
import { Icon } from './Icon'

export const HLine = memo(function HLine({
  line,
  lang,
  tail,
}: {
  line: string
  lang: string
  tail?: React.ReactNode
}) {
  const toks = tokenize(line, lang)
  return (
    <>
      {toks.map((t, i) =>
        t.c ? (
          <span key={i} className={'tok-' + t.c}>
            {t.t}
          </span>
        ) : (
          t.t
        ),
      )}
      {tail}
      {'\n'}
    </>
  )
})

export function CodeBlock({ code, lang, file }: { code: string; lang?: string; file?: string }) {
  const [ok, setOk] = useState(false)
  const lg = lang || (file ? langOf(file) : 'ts')
  return (
    <div className="codeblk">
      <div className="ch">
        <Icon name="file" size={12} />
        <span className="grow">{file || lg}</span>
        <button
          className="cbcopy"
          onClick={() => {
            copyText(code)
            setOk(true)
            setTimeout(() => setOk(false), 1400)
          }}
          aria-label="Скопировать"
        >
          <Icon name={ok ? 'check' : 'copy'} size={12} />
          {ok ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      <pre>
        {code.split('\n').map((l, i) => (
          <HLine key={i} line={l} lang={lg} />
        ))}
      </pre>
    </div>
  )
}
