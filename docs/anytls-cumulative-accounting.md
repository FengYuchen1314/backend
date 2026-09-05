# AnyTLS cumulative accounting

The panel polls the authenticated, non-reset `/node/anytls/usage` endpoint. Only
HTTP 404 means an older Agent without this endpoint; authentication failures,
timeouts and invalid responses fail the poll without consuming any counters.
The existing native Xray collection continues independently after a failed poll.

## Atomic delivery

`AnyTlsUsageLedger` is keyed by physical node UUID and Agent ledger epoch. Each
poll locks its ledger row and applies positive cumulative deltas in the same
PostgreSQL transaction as user traffic, first/last connection timestamps, optional
raw per-user history, raw node history and multiplied node traffic. A failed
transaction can be replayed; a lost success response cannot bill the same bytes
twice. Older snapshots do not rewind the watermark. Incomparable counters fail
closed. Deleted users are consumed without being recreated.

Counters are canonical decimal strings and arithmetic uses BigInt. User and node
multiplier fractions are retained separately at nano precision. Below-threshold
bytes remain pending, rather than disappearing on each poll. PostgreSQL overflow
rolls back the cursor and all writes. One user may have independent usage on
different physical nodes or different Agent epochs.

Only numeric panel user IDs are billable. Wrapper bytes are not billed separately.
AnyTLS does not enter the native reset-based Redis usage queue. First-connection
notifications are best effort after commit; their delivery is not transactional.
Native/Mieru accounting and Redis export streams have not been redesigned here.

## Agent dependency and limits

The panel bootstrap artifact pin now targets Actions-built Node commit
`9dc8750f346081f62dee6c20d9e2846d531815e5`, image
`ghcr.io/fengyuchen1314/node@sha256:3293d71dcab6838d470e3da70bd56661509847fef5966adafffe6ff1f8dfd286`.
Node CI 33960252397 and image run 33960252377 passed. The portable native bundle
passed 35/35 tests with zero skips on VPS 185.99.135.224 in
`/opt/xboard-anytls-test.PR0MiJtd`; the full Agent API smoke is tracked separately.
Existing panel installations are not updated by changing this build-time pin.

The Agent persists an epoch before returning its first cumulative snapshot and
refuses legacy reset calls afterwards. Keep its private state volume across
recreation; do not roll back to an older Agent that cannot read the ledger field.
Regular checkpoints target five seconds, with graceful final draining. A power
failure before durable sampling can still lose unsampled core traffic; disk or
core failures can widen that window. This is not a zero-loss crash guarantee.

## Verification status

Local unit tests, TypeScript checking and lint passed. PostgreSQL tests cover
concurrent duplicates, out-of-order delivery, fractional charging, rollback and
retry, physical-node scoping, new epochs, counters above JavaScript's safe integer
range, disabled optional history and deleted users. Actions and VPS execution of
these database tests passed at the accepted checkpoint below.

Managed creation, installer enablement/state mounts, complete native-client to
real-panel accounting and live-panel rollout remain separate acceptance work.

## Accepted accounting checkpoint — 2026-09-05

Functional backend commit `6c2105e30df3ac0c46619ec73eb76b9dbf40d19f`:

- [CI 33961044908](https://github.com/FengYuchen1314/backend/actions/runs/33961044908)
  passed formatting, lint, source tests, native client regressions, database
  migrations/concurrency tests, application build, dependency/API wiring and
  compilation/replay of the portable acceptance bundle. Both AnyTLS PostgreSQL
  tests executed successfully with zero skips.
- [Image 33961045024](https://github.com/FengYuchen1314/backend/actions/runs/33961045024)
  passed with frontend `db3fc697571735f5dc38ac1044d9c96ad676566c`. Digest:
  `ghcr.io/fengyuchen1314/backend@sha256:13c84f2c2ab23442ba75ac640c2b1cde046942a0ff9439eb228052ef59721acc`.
- Artifact `9967976249`, ZIP SHA-256
  `2f371fdc3609a025c938479889bd3fb6ee56dcce57d6d601761fee918b34da1a`,
  tar SHA-256 `0b5b257faa2b32e9f9e7fdc0ddc598ae372750af06ee6283fa06ecb1d88849d4`.
  It was transferred directly to VPS 185.99.135.224, checksum-verified and extracted
  under `/opt/xboard-anytls-panel-test.67x8tkHP`.
- `panel-acceptance.log`: 41/41 compiled panel tests passed, zero skips, using the
  earlier pinned dependency image. `database-acceptance.log`: the new full image's
  OCI source revision matched the artifact, all migrations succeeded, and both
  compiled PostgreSQL identity/accounting tests passed with zero skips.
  The database used its own internal network and tmpfs storage, no host ports,
  Docker socket or existing panel database. Test containers and network were removed.
- The current Node image additionally passed real encrypted Mihomo TCP through
  shared 443 into its cumulative API, with stable nonzero counters after repeated
  polls, reconciliation, restarts and listener removal. Evidence is in Node's
  `docs/anytls-cumulative-usage.md`; this is not a claim that a real panel poll has
  yet billed that exact native-client session end to end.

The original 16 VPS container IDs were still running after testing and the PDF
service returned HTTP 200 on port 38100. The existing browser test panel was not
upgraded. Source and test scripts were built only in Actions; the VPS ran them.

Frontend editor repairs are independent: Mieru no longer mounts the Xray WASM
loader, and unavailable Xray validation requires the existing explicit Save Anyway
confirmation. Frontend `406ebfee` passed CI 33961619989; the follow-up source is
`a0c767388740106c2e87e1841d6b9ff42f83fbd3` (38 local tests/typecheck/changed-file lint
passed). The obsolete intermediate paired run 33961934000 was intentionally
cancelled. [Paired run 33962077276](https://github.com/FengYuchen1314/backend/actions/runs/33962077276)
uses backend `6c2105e3` and this final frontend revision; it was still running when
this checkpoint was written. Do not claim browser acceptance or an image digest
for that new pair yet.
