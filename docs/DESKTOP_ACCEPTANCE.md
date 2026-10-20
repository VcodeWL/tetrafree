# Desktop checkpoint / Windows acceptance

This is an operator plan, **not evidence of a completed native Windows run**. Linux unit tests and cross-target type checks do not validate WebView2, Windows dialogs/tray, OS registration, notifications or signed upgrades. Release remains draft until native acceptance.

## Safety and evidence

Use a disposable Windows10/11 VM, a clean non-production profile, disposable projects and staging updater keys/artifacts. Never change production updater endpoints/keys or real user storage for this test. Keep screenshots, relevant bounded logs, artifact hashes and exact build/features; do not include passwords, API keys, tokens or document contents. Windows power-off, Task Manager forced kill, crashes and OS-enforced shutdown are not vetoable data-durability guarantees.

The script verifies the **expected SHA256** supplied through a trusted release channel before any optional launch. Authenticode checking is separate and opt-in because existing builds may not have a certificate. Neither a matching hash nor Authenticode validates the updater Ed25519 signature. No dependency installation or settings changes are automated.

```powershell
# Read-only evidence skeleton. Exit2 means manual acceptance is pending, not an app failure.
powershell -NoProfile -File scripts/acceptance-desktop.ps1 `
  -AppPath 'C:\Program Files\TetraFree\TetraFree.exe' `
  -ExpectedSha256 '<trusted 64-character SHA256>' -ReportPath 'C:\acceptance\desktop.json'

# Disposable VM only; launches the app and asks for observations, never silently marks cases passed.
powershell -NoProfile -File scripts/acceptance-desktop.ps1 `
  -AppPath 'C:\Program Files\TetraFree\TetraFree.exe' `
  -ExpectedSha256 '<trusted 64-character SHA256>' -DisposableVm -Launch -Interactive
```

## Checkpoint protocol and cases

Native main-window close, tray explicit quit and ExitRequested are prevented until a fresh32-byte random token receives a matching single durable-save ACK within8s. ACK from another webview/window, wrong/late/replayed token, failure, absent JS readiness or timeout cannot authorize normal quit. Update requests the checkpoint **after download**, before backend stop/installer invocation. A valid native ACK is a persistence checkpoint at that point, not an indefinite freeze of all future background state.

The frontend waits for registered `flushPersistence()` and rejects success if the runtime revision changed during the flush. It sends false for errors/timeouts and does not turn a late flush into a success ACK. Native failure shows the main window and a real warning dialog (even if the frontend cannot render its toast). Repeated warning requests are bounded to one outstanding dialog. Normal OS power-off/forced kill may bypass app logic; do not claim otherwise.

1. **All close paths:** tray OFF, edit a disposable doc and immediately native-close/Alt+F4; reopen and compare latest content. Repeat titlebar and explicit Quit. Browser-only beforeunload is not the native guarantee.
2. **Failure/timeout:** in a disposable diagnostic VM reproduce an actual storage transaction/quota/permission failure, or suspend the main webview to withhold ACK. Close/tray Quit/update must keep the app and backend alive, show warning and not invoke installer. Recover and retry successfully. Unit-injected failures alone are not native acceptance. Do not fill the host/shared disk or corrupt production IDB.
3. **Tray/background:** new profile has tray OFF. Enable it, close -> checkpoint then hide, verify agent/backend still working; restore via icon. Explicit tray Quit must save then stop. Disable tray while hidden via restored window; window stays reachable. `--minimized` without tray must show a window.
4. **Autostart:** defaults OFF; opt-in via Settings, verify OS registration and next disposable logon. Turning it OFF removes registration. No autostart installation during a normal app launch. No background operation is promised after an actual process exit.
5. **Notifications:** native opt-in defaults OFF independently from automation consent. Foreground never alerts; background opted-in event gives one generic bounded OS message, rate-limited (5s). Confirm the desktop path does not also emit browser Notification. Windows notification settings/DoNotDisturb may suppress delivery; plugin's desktop permission=Granted is NOT proof that OS displayed a toast.
6. **Update:** genuine staging-signed N->N+1. Edit during download, verify the final native checkpoint sees those edits. Test extraction/installer-dispatch failure after download and backend recovery, invalid signature rejection, and version/target/URL/signature correspondence. Never invent signed-artifact results.
7. **Processes:** track disposable PTY/exec/MCP descendants with their process handles/tree. Quit/restart/update should clean the owned tree; validate app Job fallback. External editors can still be covered by the backend Job (known pending limitation); no blanket promise that they survive.
8. **Race tests:** repeated close clicks, close during download/install, missing frontend readiness, late/replayed ACK. No duplicate installer invocation, no accidental exit on checkpoint failure.

## CI versus operator assertions

Rust checkpoint/notification-policy unit tests are standard `cargo test --lib` modules. Frontend handler tests live in `src/lib/desktopLifecycle.test.ts` (parent must include in npm test). Windows CI smoke remains a prerequisite; the acceptance script is intentionally not an unattended green stub: it exits2 while cases are NOT_RUN/SKIP/FAIL. An all-PASS interactive result is explicitly `OPERATOR_REPORTED_PASS`, not automated proof. Keep default/extras/updater feature combinations in native CI when possible.
