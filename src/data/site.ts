/* Генератор dev-превью сайта проекта. Разметка стабильная, чтобы агент мог
   точечно править её строковыми патчами (акцент, заголовок, секции). */
export interface SiteOpts {
  name: string
  accent: string
  eyebrow: string
  headline: string
  sub: string
  cta: string
  radius: number
  sections: string[]
  badge?: string
}

export const SECTION_HTML: Record<string, string> = {
  features: `<section class="grid" data-s="features">
      <div class="card"><b>Live-reload</b><span>Предпросмотр обновляется при сохранении — без ручного рестарта.</span></div>
      <div class="card"><b>WGPU</b><span>Один рендер-граф для Vulkan, Metal и WebGPU.</span></div>
      <div class="card"><b>Sync</b><span>Совместная правка сцены через TetraSync.</span></div>
    </section>`,
  batching: `<section class="band" data-s="batching">
      <div><small>Новое в sync</small><h2>Батчинг событий</h2><p>N правок за один проход вместо N отдельных. Средний CPU на массовом сохранении −38%.</p></div>
      <div class="meter"><i style="width:62%"></i></div>
    </section>`,
  pricing: `<section class="grid" data-s="pricing">
      <div class="card"><b>Open Source</b><span class="price">0 ₽</span><span>Ядро движка и CLI.</span></div>
      <div class="card hl"><b>Studio</b><span class="price">1 900 ₽/мес</span><span>Облачные сборки и совместная сцена.</span></div>
      <div class="card"><b>Enterprise</b><span class="price">по запросу</span><span>On-prem, SSO и SLA.</span></div>
    </section>`,
  faq: `<section class="faq" data-s="faq">
      <h2>Вопросы</h2>
      <details open><summary>Работает в браузере?</summary><p>Да, через WebGPU — те же шейдеры, что и в нативной сборке.</p></details>
      <details><summary>Какая лицензия?</summary><p>Ядро — MIT, облачные сервисы — по подписке.</p></details>
    </section>`,
  testimonials: `<section class="quote" data-s="testimonials">
      <blockquote>«Перенесли редактор уровней за выходные — синхронизация просто работает».</blockquote>
      <cite>— Имя Фамилия, должность</cite>
    </section>`,
}

export function siteHtml(o: SiteOpts) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${o.name}</title>
<style>
  :root { --accent:${o.accent}; --radius:${o.radius}px; --bg:#0a0a0d; --fg:#f4f4f7; --mute:#8d8d98; --line:rgba(255,255,255,.08); }
  * { box-sizing:border-box; margin:0 }
  body { font:15px/1.6 Inter,-apple-system,system-ui,sans-serif; background:var(--bg); color:var(--fg); }
  header { display:flex; align-items:center; gap:24px; padding:22px 48px; border-bottom:1px solid var(--line); }
  header .logo { font-weight:700; letter-spacing:-.02em; }
  header nav { display:flex; gap:20px; color:var(--mute); font-size:13.5px; }
  header .gh { margin-left:auto; font-size:13px; color:var(--mute); border:1px solid var(--line); padding:6px 12px; border-radius:8px; }
  main { max-width:880px; margin:0 auto; padding:72px 48px 96px; display:flex; flex-direction:column; gap:56px; }
  .hero small { color:var(--accent); font-weight:600; letter-spacing:.14em; text-transform:uppercase; font-size:11.5px; }
  .hero h1 { font-size:46px; line-height:1.05; letter-spacing:-.035em; margin:14px 0 16px; font-weight:650; max-width:640px; }
  .hero p { color:var(--mute); max-width:520px; font-size:16px; }
  .btn { display:inline-block; margin-top:28px; padding:12px 22px; border-radius:var(--radius); background:var(--accent); color:#0a0a0d; font-weight:650; text-decoration:none; }
  .badge { display:inline-flex; margin-left:12px; font-size:12px; color:var(--mute); border:1px solid var(--line); padding:4px 10px; border-radius:99px; vertical-align:middle; }
  .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
  .card { border:1px solid var(--line); border-radius:14px; padding:18px; display:flex; flex-direction:column; gap:6px; background:rgba(255,255,255,.015); }
  .card b { font-size:14.5px; } .card span { color:var(--mute); font-size:13.5px; }
  .card.hl { border-color:var(--accent); } .price { color:var(--fg)!important; font-size:20px!important; font-weight:650; }
  .band { display:flex; align-items:center; gap:32px; border:1px solid var(--line); border-radius:16px; padding:26px 28px; }
  .band small { color:var(--accent); font-weight:600; font-size:11.5px; text-transform:uppercase; letter-spacing:.12em; }
  .band h2 { font-size:22px; margin:6px 0; letter-spacing:-.02em; } .band p { color:var(--mute); font-size:14px; }
  .meter { flex:0 0 200px; height:8px; border-radius:9px; background:rgba(255,255,255,.06); overflow:hidden; }
  .meter i { display:block; height:100%; background:var(--accent); }
  .faq h2 { font-size:22px; margin-bottom:10px; } details { border-top:1px solid var(--line); padding:12px 0; }
  summary { cursor:pointer; font-weight:600; } details p { color:var(--mute); margin-top:6px; }
  .quote blockquote { font-size:22px; letter-spacing:-.02em; max-width:620px; } .quote cite { color:var(--mute); font-style:normal; display:block; margin-top:10px; }
  footer { border-top:1px solid var(--line); padding:22px 48px; color:var(--mute); font-size:12.5px; display:flex; justify-content:space-between; }
  @media (max-width:700px){ header{padding:18px 20px} header nav{display:none} main{padding:48px 20px} .hero h1{font-size:32px} .grid{grid-template-columns:1fr} .band{flex-direction:column;align-items:flex-start} .meter{flex-basis:auto;width:100%} }
</style>
</head>
<body>
  <header><span class="logo">${o.name}</span><nav><a>Документация</a><a>Примеры</a><a>Блог</a></nav><span class="gh">GitHub ★ 4.2k</span></header>
  <main>
    <section class="hero">
      <small>${o.eyebrow}</small>
      <h1>${o.headline}</h1>
      <p>${o.sub}</p>
      <a class="btn" href="#">${o.cta}</a>${o.badge ? `<span class="badge">${o.badge}</span>` : ''}
    </section>
    ${o.sections.map((s) => SECTION_HTML[s] || '').join('\n    ')}
    <!-- sections -->
  </main>
  <footer><span>© ${new Date().getFullYear()} ${o.name}</span></footer>
</body>
</html>
`
}

export function blankSite(name: string) {
  return siteHtml({
    name,
    accent: '#b9a6ff',
    eyebrow: 'Новый проект',
    headline: `${name} — каркас готов`,
    sub: 'Опиши агенту, что нужно собрать, — превью обновится с каждой правкой.',
    cta: 'Начать',
    radius: 10,
    sections: [],
  })
}
