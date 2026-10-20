# Sync restoration after environment rollback

## Outcome and evidence

Restored only owned sync/team/journal production logic plus owned tests/fixture. This is **replay after rollback**, not a new design and not the pre-rollback test result reused as current evidence.

Exact own historical Bash patches were recovered from committed session events **379, 385, 423, 427**, saved under `sync-rollback-replay/event-*.sh`, and replayed once against the rolled-back files. Generation replay/A01/A02 parts already existed; later patches restored:

- **A03** actual application PersistStorage.setItem+flush committed redo fixtures, actual envelope revision assertions, legacy unknown-generation visible recovery.
- **A01** uncertain attempted-path retention after failed CAS and through accepted ack/checkpoint; no silent first-create resurrection on later retry. Third-party bytes retained in recovery copy.
- **A04** fresh recovered journal replay requires actual older hydrated checkpoint AND runtime mutation counter zero. Missing/uncertain provenance preserves live human file/metadata and desired/prior visible JSON; warning; 0 outgoing; no clean advance. Persistent recoveryBlocked preserves original appRevision and prevents cached second retry bypass.
- Fixture runtime human actions, two retries, warnings; actual child process redo coverage restored.

Original ST06–09/ST11/ST18/D07 changes and A02 directory membership/watcher behavior retained. ST10/D01/domain and persistence APIs remain other owners' work. No backend/server/store/types/package/version edits by this owner.

## New current validation

- `sync-rollback-tests.log`: **50/50 PASS**, no skipped/cancelled tests.
- `sync-rollback-lint.log`: owned ESLint, 0 diagnostics.
- `sync-rollback-typecheck.log`: only diagnostics in ten owned files, not a global check.
- `sync-rollback-sha256.txt`: current stable SHA inventory, checked unchanged after scoped validation.
- Four entries retained in `sync-test-files.txt`; fixture is helper only. No package script edits.
- Independent reviewer notified of stable bytes for new desired25 + scoped172 verification. Historical independent PASS is NOT current re-acceptance.

Original final whole-file SHA inventory was lost by rollback and was not printed in available own history. Thus exact historical **patch replay** is established, but whole-file historical final SHA equality is NOT claimed. Persistence owner separately reported exact restored dependency hashes: index `85c6268e6a46ef6c323b24083f29239d9ff471049279a5113cb5cd969a73dfac`, persistence `24ef4a9d8180cf2c3b33c30b313721d105c0890f0d94035bc7b81baeee975be2`.

`sync-runtime-fixes.md` was recovered from exact historical report command, clearly marked historical. Missing old logs were not fabricated. Repository currently lacks `.git`; no attempt to initialize Git, commit or push.

## Retained limits — not atomicity certification

- No single transaction spans app persistence, ack journal, baseline and external filesystem/cloud. Both persistence backends failing cannot persist new intent. Journal ambiguity can stop sync pending manual recovery; visible copies are not a CRDT/resolution UI.
- Runtime proof depends on root hydration/publish API coverage restored by persistence owner. Unrelated runtime edits conservatively block replay. No cross-window/process ordering guarantees added.
- Server expectedHashes CAS is not atomic against arbitrary external OS writers; UTF8 text/FNV isn't byte-exact binary backup or cryptographic CAS.
- Transport window80 does not truncate existing local chat history but newly joining devices still receive bounded history.
- Controlled Linux tests are not native Windows/IDB/power-loss/network/fsync certification. No browser, global formatting/check/build or push run by this owner.

Owned production and test edits stopped at stable handoff. Remaining safety limitations are intentionally explicit, not marketed as transparent automatic convergence.
