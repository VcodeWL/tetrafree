/* Единый набор иконок: только контур, stroke 1.8 (см. дизайн-гайд). */
export const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/>',
  doc: '<path d="M14 3v5h5M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M8 13h8M8 17h5"/>',
  task: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M14 9l2 2 3-3"/>',
  code: '<path d="M8 6l-5 6 5 6M16 6l5 6-5 6"/>',
  browser: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  chevd: '<path d="M6 9l6 6 6-6"/>',
  chevl: '<path d="M15 6l-6 6 6 6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  attach: '<path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 6"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users:
    '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>',
  ram: '<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 7v-2M10 7v-2M14 7v-2M18 7v-2M6 21v-2M18 21v-2"/>',
  disk: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3"/>',
  py: '<path d="M12 3c-3 0-4 1.5-4 3v2h5M12 3c3 0 4 1.5 4 3v4a3 3 0 0 1-3 3H9a3 3 0 0 0-3 3v2c0 1.5 1 3 4 3M9 6h.01"/>',
  node: '<path d="M12 2l8 4.5v9L12 20l-8-4.5v-9z"/><path d="M12 11v6"/>',
  db: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.6 3.6 3 8 3s8-1.4 8-3V6M4 12c0 1.6 3.6 3 8 3s8-1.4 8-3"/>',
  rocket: '<path d="M5 12l7-9 7 9-7 9z"/>',
  sparkle: '<path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z"/>',
  bolt: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
  paint:
    '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.2"/><circle cx="12" cy="8" r="1.2"/><circle cx="16" cy="10" r="1.2"/>',
  git: '<circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="9" r="2.4"/><path d="M18 11a6 6 0 0 1-6 6H6M6 8.4v7.2"/>',
  down: '<path d="M12 3v13M7 11l5 5 5-5M5 21h14"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
  userplus: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0M19 8v6M22 11h-6"/>',
  tree: '<path d="M12 3v6M6 21v-3a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v3"/><rect x="9" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l7-7 3 3M16 7l2 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  warn: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  target:
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.5" fill="currentColor"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff:
    '<path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  more: '<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/>',
  upload: '<path d="M12 16V3M7 8l5-5 5 5M5 21h14"/>',
  grip: '<circle cx="9" cy="6" r="1.1" fill="currentColor"/><circle cx="15" cy="6" r="1.1" fill="currentColor"/><circle cx="9" cy="12" r="1.1" fill="currentColor"/><circle cx="15" cy="12" r="1.1" fill="currentColor"/><circle cx="9" cy="18" r="1.1" fill="currentColor"/><circle cx="15" cy="18" r="1.1" fill="currentColor"/>',
  keyboard:
    '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  minus: '<path d="M5 12h14"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  sort: '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  board:
    '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  h2: '<path d="M4 6v12M12 6v12M4 12h8M16 10a2 2 0 1 1 4 0c0 2-4 3-4 8h4"/>',
  text: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  quote: '<path d="M7 7h4v6H5V9a2 2 0 0 1 2-2zM15 7h4v6h-6V9a2 2 0 0 1 2-2zM7 13v4M15 13v4"/>',
  checksq: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/>',
  mobile: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  desktop: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  tablet: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  cursor: '<path d="m4 3 7 18 2.5-7.5L21 11z"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 0 1 4 0v6a8 8 0 0 1-8 8h-2a8 8 0 0 1-7-4l-2.5-4.5a2 2 0 0 1 3.5-2L10 15"/>',
  frame: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  layers: '<path d="M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
  ruler: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  pin: '<path d="M12 22c4-4 8-7.6 8-12a8 8 0 1 0-16 0c0 4.4 4 8 8 12z"/><circle cx="12" cy="10" r="2.5"/>',
  grid: '<path d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18"/>',
  cross: '<path d="M12 3v18M3 12h18"/>',
  share: '<path d="M4 12v8h16v-8"/><path d="M12 3v13M7 8l5-5 5 5"/>',
  pen: '<path d="m12 19 7-7-3-3-7 7-3 1 1-3 7-7 3 3"/><path d="M18 6 20 4"/>',
  arrowdown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  dot: '<circle cx="12" cy="12" r="4" fill="currentColor"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  btnblock: '<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M9 12h6"/>',
  cardblock:
    '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 14h8M8 17.5h4"/><rect x="8" y="7.5" width="8" height="3" rx="1"/>',
  rowblock:
    '<rect x="3" y="5" width="8" height="14" rx="2"/><rect x="13" y="5" width="8" height="14" rx="2"/>',
  divblock: '<path d="M6 12h12M4 8v8M20 8v8"/>',
  imgblock:
    '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 9"/>',
} as const

export type IconName = keyof typeof ICONS

export const BRAND_PATHS: Record<string, string> = {
  openai:
    '<path fill="currentColor" d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6 6 0 0 0 4.98 4.18a5.98 5.98 0 0 0-3.99 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 22a6.05 6.05 0 0 0 5.77-4.21 5.99 5.99 0 0 0 3.98-2.9 6.05 6.05 0 0 0-.75-7.06zm-9.02 12.6a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.79.79 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.5 4.5zM3.6 18.3a4.47 4.47 0 0 1-.54-3.01l.14.09 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.74 22a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9a4.48 4.48 0 0 1 2.34-1.97V11.6a.77.77 0 0 0 .39.68l5.84 3.37-2.02 1.17a.07.07 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.9zm16.6 3.86-5.84-3.37 2.02-1.17a.07.07 0 0 1 .07 0l4.83 2.79a4.5 4.5 0 0 1-.68 8.12v-5.68a.79.79 0 0 0-.4-.69zm2.01-3.03-.14-.09-4.78-2.76a.78.78 0 0 0-.78 0L9.42 9.25V6.92a.08.08 0 0 1 .03-.06L14.26 4a4.5 4.5 0 0 1 6.68 4.65zM8.32 12.9l-2.02-1.17a.07.07 0 0 1-.04-.05V6.1a4.5 4.5 0 0 1 7.38-3.45l-.14.08L8.72 5.5a.79.79 0 0 0-.39.68l-.01 6.73zm1.1-2.36L12 9.05l2.6 1.5v3l-2.6 1.5-2.6-1.5v-3z"/>',
  anthropic:
    '<path fill="currentColor" d="M12.9 3.5a1 1 0 0 0-1.82 0L4.2 20.24A1 1 0 0 0 5.13 21.6H6.3a1 1 0 0 0 .93-.64L8.5 17.6h7l1.27 3.36a1 1 0 0 0 .93.64h1.17a1 1 0 0 0 .93-1.36L12.9 3.5zM9.4 14.4 12 7.5l2.6 6.9H9.4z"/>',
  ollama:
    '<path fill="currentColor" d="M7.9 2.4c-.52 0-.94.52-.94 1.16v1.98C6 6.04 5.4 6.98 5.2 8.3c-.1.62-.12 1.44-.12 2.46v4.9c0 2.16 1.5 3.98 3.5 4.5v1.12c0 .3.24.54.54.54h.98c.3 0 .54-.24.54-.54v-.94h2.72v.94c0 .3.24.54.54.54h.98c.3 0 .54-.24.54-.54v-1.12c2-.52 3.5-2.34 3.5-4.5v-4.9c0-1.02-.02-1.84-.12-2.46-.2-1.32-.8-2.26-1.76-2.76V3.56c0-.64-.42-1.16-.94-1.16s-.94.52-.94 1.16v1.46c-.3-.04-.62-.06-.96-.06H9.8c-.34 0-.66.02-.96.06V3.56c0-.64-.42-1.16-.94-1.16zm4.1 8.3c1.7 0 3 .9 3 2.2 0 .6-.5.9-1 .6-.5-.3-1.2-.5-2-.5s-1.5.2-2 .5c-.5.3-1 0-1-.6 0-1.3 1.3-2.2 3-2.2z"/>',
  custom:
    '<path fill="currentColor" d="M12 2 20.66 7v10L12 22 3.34 17V7L12 2zm-1.1 6-4 6.4H10l-1 4.6 5.1-6.6H11l1-4.4h-1.1z"/>',
}

export const GITHUB_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.5 2 2 6.6 2 12.3c0 4.5 2.9 8.3 6.8 9.7.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.4-3.4-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10.3 10.3 0 0 0 22 12.3C22 6.6 17.5 2 12 2z"/></svg>'
export const GOOGLE_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.6 12.2c0-.66-.06-1.3-.17-1.9H12v3.6h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.89-1.74 2.99-4.3 2.99-7.22z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.23-2.5c-.9.6-2.04.96-3.39.96-2.6 0-4.8-1.76-5.59-4.13H3.07v2.6A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.41 13.9a6 6 0 0 1 0-3.8v-2.6H3.07a10 10 0 0 0 0 9z"/><path fill="#EA4335" d="M12 6.06c1.47 0 2.79.5 3.83 1.5l2.85-2.85A10 10 0 0 0 3.07 7.5l3.34 2.6C7.2 7.8 9.4 6.06 12 6.06z"/></svg>'
