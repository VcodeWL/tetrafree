/* Native SOURCE invariants only. These do not execute or compile a Windows GUI. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = (file: string) => readFileSync(new URL('../../src-tauri/src/' + file, import.meta.url), 'utf8')
test('all four feature combinations register checkpoint commands; main close/exit are gated (source)', () => {
  const lib = read('lib.rs'),
    bridge = read('desktop_checkpoint.rs')
  assert.equal((lib.match(/desktop_checkpoint::desktop_checkpoint_ack,/g) || []).length, 4)
  assert.match(lib, /on_window_event\(desktop_checkpoint::on_window_event\)/)
  assert.match(lib, /RunEvent::ExitRequested/)
  assert.match(lib, /api.prevent_exit\(\)/)
  assert.match(bridge, /api.prevent_close\(\)/)
  assert.match(bridge, /Duration::from_secs\(8\)/)
  assert.match(bridge, /getrandom::fill/)
  assert.match(bridge, /window.label\(\) == "main"/)
  assert.match(bridge, /warning_open/)
  assert.match(bridge, /MessageDialogKind::Warning/)
})
test('updater final checkpoint precedes server stop and installer, after download (source)', () => {
  const update = read('updates.rs')
  const download = update.indexOf('.download('),
    save = update.indexOf('desktop_checkpoint::save(')
  const stop = update.indexOf('child.stop()?'),
    install = update.indexOf('update.install(bytes)')
  assert.ok(download >= 0 && save > download && stop > save && install > stop)
  assert.match(update.slice(save, stop), /return Err\(error\)/)
})
test('tray Quit uses checkpoint; native notifications default off, main-window checked, bounded and gated (source)', () => {
  const extras = read('extras.rs')
  assert.match(extras, /"quit" => crate::desktop_checkpoint::request_close/)
  assert.match(extras, /NOTIFICATIONS: AtomicBool = AtomicBool::new\(false\)/)
  assert.match(extras, /if tray_enabled\(\)/)
  assert.match(extras, /window.is_focused\(\)/)
  assert.match(extras, /Duration::from_secs\(5\)/)
  assert.match(extras, /notification_policy::payload/)
})

test('native notification toggle updates existing global consent after native success (source)', () => {
  const ui = readFileSync(new URL('../components/DesktopSystem.tsx', import.meta.url), 'utf8')
  assert.ok(ui.indexOf('await sysSetNotifications(on)') < ui.indexOf("setSetting('osNotify', on)"))
  assert.match(ui, /info.notifications && !!globalNotify/)
})
test('Windows acceptance never silently passes pending cases or launches an unverified artifact (source)', () => {
  const script = readFileSync(new URL('../../scripts/acceptance-desktop.ps1', import.meta.url), 'utf8')
  assert.ok(script.indexOf('Artifact SHA256 mismatch') < script.indexOf('Start-Process'))
  assert.match(script, /status = 'NOT_ACCEPTED'/)
  assert.match(script, /result = 'NOT_RUN'/)
  assert.match(script, /OPERATOR_REPORTED_PASS/)
  assert.match(script, /exit 2/)
})
