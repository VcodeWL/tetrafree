# Windows / Tauri repair handoff

Scope completed in `/data/tetrafree`. No push, browser, global check/build, package.json/package-lock, app version, tetra-server/auth edits by this agent. Formatting only owned files. Main/server agent owns exec changes and shutdown handler. Resources `fs-safety.mjs`, `process-safety.mjs`, `preview.mjs` added to tauri.conf.json from the confirmed contract.

## Implemented IDs (source changes, NOT native certification)

| ID | Changes | Evidence / remaining validation |
|---|---|---|
| W01 | Rust `ManagedChild` owns a Windows Job (`KILL_ON_JOB_CLOSE`), Node starts suspended, assigned before resuming its primary thread; assignment/resume fail closed. Exit/restart/update share parent stdin shutdown (`{"type":"tetra-shutdown"}\n`), 5s bounded grace, whole Job termination and root wait. ConPTY also assigns suspended shell to a nested Job, so standalone helper EOF/exit owns descendants. | Actual Windows-target FFI typecheck incl. new process-tree test passes. The process-tree test itself and native app exit/restart/update paths have NOT run here. Server graceful handler already integrated by server agent. See new audit N-W01 below. |
| W02 | LifecycleGate serializes installs/restarts, including download. Install error respawns backend and restores state; combined install/recovery errors logged/returned. | Atomic-gate concurrency/error-release tests execute on Linux. Real installer recovery and full Tauri compilation are unverified. |
| W03 | Required smoke runs production PowerShell 5.1 AND cmd. Compiles a native console probe: output combines separately supplied random fragments (never an expected token in input echo), reports real GetConsoleScreenBufferInfo size, emits generated Cyrillic. Requires initial dimensions, actual changed dimensions, expected exit; separate exit256 test. Authenticated HTTP PTY open/stream/input/resize/exit test plus parent-control graceful shutdown. | Exact production JS assertions executed against echo-only/ignored-resize/wrong-exit/hung-exit harnesses: all rejected; proper harness accepted. This is a harness regression, not Windows ConPTY evidence. |
| W06 | Both open/resize strictly reject fractional/nonfinite/non-numeric/null values with 400; defaults only when omitted, integers clamped. Native helper validates initial and resize bounds. | Actual JS routes exercised with real Linux helper; native C# validation only source/static tests. |
| W07 (PTY) | 4 subscribers/session; 512KiB writable backlog cap disconnects slow response (ring replay on reconnect), 256KiB output ring, bounded input length/queue. Does not pause all readers for one slow consumer. | Actual ptyWrite slow-response harness stays bounded; actual routes enforce subscriber/input cap. Not a RAM stress benchmark. Exec portion belongs to server agent. |
| W08 | Release `needs: verify` invokes reusable CI on caller SHA; checkout explicitly uses github.sha, with Windows smoke and locked Rust checks/tests required. Tag must match checked source versions. Artifact is a DRAFT, not auto-published. | YAML parsed; source gate regression tests pass. No GitHub Actions/release execution occurred. Installed bundle and signatures require manual acceptance before publication. |
| W09 | SHA256 instead of equal size; copy to unique temp, digest check, atomic rename, verify final digest; no execution of unknown cached binary. Rust host/explicit target must match executing Node platform/arch, otherwise fail closed. | Real filesystem same-size stale/identical-copy tests pass. No PE binary or ARM64 native test here. |
| W12 | Removed network-installed unpinned node-pty and unbounded diagnostic matrix. Optional diagnostics are offline informational only; required checks separate. Bounded subprocess/HTTP/exit/overall watchdog, tracked child tree cleanup/finally, step/job timeouts. | Regression/source inspection and syntax checks. Native timeout cleanup still acceptance-required. |
| W13 | Streaming bounded helper stderr (4KiB), secret/control-character sanitization, server log diagnostics, generic structured lastFailure. Authenticated `/api/pty/status` exposes helperAvailable separately from runtime (`unproven`/`output-observed`/`failed`); does NOT claim that first output means command readiness. Added missing native API failure diagnostics. | JS status/queues/routes tested; C# error branches static only. Existing health.pty remains helper-availability for compatibility; status endpoint + authenticated command smoke provide separate runtime evidence. |
| W14 | Explicit `\\?\UNC\` -> `\\` conversion before local verbatim prefix removal. | Actual Rust function unit test for drive, UNC, Cyrillic, unchanged relative path passes on Linux; real network-share/long-path entrypoint untested. |
| W15 | `Environment.Exit(unchecked((int)code))`, no 8-bit truncation. | Source regression test; native exit256 requirement added to Windows smoke, not executed locally. |
| W16 | Actual generated `src-tauri/Cargo.lock` (511 resolved packages); immutable action SHAs resolved from GitHub refs; Node22.16.0, Rust1.90.0 pinned; check/test/build use --locked. | Lock generation succeeded with actual Cargo, not fabricated. Entire dependency graph/native app build remains unverified. Do not interpret rust-version=1.77 as a tested graph MSRV. |

W04, exec W05/W07/W10/W11: delegated to server agent, not claimed fixed/tested by this owner. PTY now uses its shared childEnv/killTree implementation, not a separate partial secret filter.

STARTF_USESTDHANDLES was ALREADY present and is preserved, not claimed as a newly discovered fix.

## Actual test runs

- `node --test $(cat /data/fix-tetrafree/windows-test-files.txt)` -> **23 pass, 0 fail**, no skips in this scoped suite. Files listed: existing conpty/bundle/release-notes and new server/pty-windows.test.mjs, scripts/windows.test.mjs. Log: `windows/scoped-tests.log`.
- Exact `src-tauri/src/paths.rs` compiled/executed with `rustc --test` -> **1 pass**; lifecycle.rs -> **2 pass**. Logs: `windows/{paths-tests,lifecycle-tests}.log`.
- Actual `src-tauri/src/job.rs`, including its Windows-only live root/grandchild test, cross-target **typechecked** using a minimal separate Cargo harness and windows-sys0.59 for x86_64-pc-windows-msvc. `cargo check --locked ... --tests` -> success, `windows/job-check-tests.log`. This DOES NOT execute the test or validate Win32 behavior.
- Full scoped Tauri `cargo check --locked --target x86_64-pc-windows-msvc --features extras,updater` -> **BLOCKED** in native dependency toolchain: cc-rs cannot find MSVC `lib.exe`. Log `windows/tauri-cross-check.log`. This is NOT a full Rust pass, and application/updater macros were not certified by this partial build.
- `node scripts/smoke-win.mjs` on Linux -> explicit **SKIP**, not pass; `windows/smoke-linux.log`.
- Owned-file Prettier --check, Rust rustfmt --check, JS --check, workflow YAML parse succeeded. `windows/format-check.log`.
- During development a duplicate test-block insertion was caught by cross-target --tests and removed. Final successful cross-target/test logs listed above supersede intermediate runs.

## New / residual audit (before release)

### N-W01 — explicit external-process ownership still needs design/native acceptance
All backend descendants are now deliberately inside the Job. Editor/terminal windows intentionally opened through the backend can therefore also be closed when the app stops; currently no separate explicit external-launch broker outside the Job. Do NOT enable SILENT_BREAKAWAY globally: that would undo exec/MCP/PTY tree ownership. An approved Rust-side external-launch broker (outside backend Job) is the safe follow-up. Treat this as a P2 behavior/data-loss risk for unsaved external-editor work, not as a verified native reproduction. W01 core is implemented, not claimed fully release-accepted.

### N-W02 — desktop persistence checkpoint on close remains pending
No UI-to-Rust checkpoint IPC/ack gate was added. Async `flushPersistence()` during unload cannot guarantee a durable checkpoint before desktop close. Backend grace/Job cleanup is NOT a replacement for frontend durable persistence. Main should leave this honestly pending (as agreed), not mark desktop-close durability fixed.

### N-W03 — genuine Windows/installed-artifact verification remains mandatory
Windows 10/11 ConPTY, nested Jobs, native root/grandchild test, graceful restart/update, real install-error backend recovery, DPAPI, UNC/long paths, ARM64/PE compatibility, WebView2/tray, installed bundle without system Node and signed upgrade artifacts were NOT run here. Full Tauri build not completed. No artifact signature, latest.json signature/URLs, Authenticode or SmartScreen claim. Release stays draft pending actual acceptance; CI source gates do not themselves certify an installed artifact.

### N-W04 — version/lock handoff
This agent did not bump any app version. If main changes Cargo.toml package version, regenerate/refresh Cargo.lock root package too before the locked gate; do not merely leave the old root version and claim reproducibility. Rust isolated toolchain is available below. Lock graph remains pinned; host runner images/SDKs are not claimed bit-for-bit hermetic.

## Toolchain / handoff

Rust installed safely in `/data/fix-tetrafree/windows/{cargo,rustup}`, without global PATH/default profile edits. For later scoped work:

```sh
export CARGO_HOME=/data/fix-tetrafree/windows/cargo
export RUSTUP_HOME=/data/fix-tetrafree/windows/rustup
export PATH="$CARGO_HOME/bin:$PATH"
# Cargo 1.90.0, rustfmt, MSVC target std installed; no MSVC linker/SDK runtime here.
```

Owned changed/new files: server/pty.mjs, server/conpty-win.mjs, server/pty-windows.test.mjs; src-tauri/src/{server,lib,updates,job,lifecycle,paths}.rs; src-tauri/Cargo.toml (Windows dependency only, version unchanged), Cargo.lock, tauri.conf.json (resources only); scripts/{smoke-win,prepare-sidecar,windows.test}.mjs; .github/workflows/{ci,release}.yml.

Main can start global check/build now. No remaining running compile/test work by this agent.
