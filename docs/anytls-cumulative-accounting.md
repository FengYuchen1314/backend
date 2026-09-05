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

Managed creation and installer enablement/state mounts remain separate acceptance
work. The full native-client to real-panel accounting checkpoint is recorded below.

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
uses backend `6c2105e3` and this final frontend revision and passed, as did frontend
CI 33962077174. Its digest is
`ghcr.io/fengyuchen1314/backend@sha256:95d4d756e14d507739d535b27ba3f4364a3a9a60bad9489f70e1ea5e03bff41f`.
Browser acceptance is tracked separately from the accounting checkpoint.

## Accepted full panel/client accounting — 2026-09-05

The plain JavaScript/bash scripts `scripts/vps-anytls-panel-e2e.*` and
`scripts/vps-anytls-panel-e2e-client.mjs` at `ac13d5e2` ran successfully on
185.99.135.224 in `/opt/xboard-anytls-e2e.CGboXtdd` (`acceptance.log`, exit 0).
They orchestrated the exact Actions-built backend image `13c84f2c…` above and
Node image `3293d71d…`; no application or native code was compiled on the VPS.

- A fresh real panel/database registered a disposable administrator and issued
  actual Agent credentials. Its public API created the profile, entitlement,
  numeric subscriber, Agent and host, and coordinated Agent startup.
- The real Mihomo subscription's unchanged encrypted proxy bundle carried native
  TCP traffic through shared port 443. The inner AnyTLS certificate pin and outer
  ShadowTLS public-CA verification remained enabled.
- Natural scheduled panel polling delivered 957 raw bytes to PostgreSQL and the
  user API as 478 charged bytes at multiplier 0.5. Node multiplier 2, raw per-user
  history, lifetime traffic, connection metadata and the cumulative cursor were
  checked against the same Agent snapshot.
- Two additional normal polling intervals left all totals unchanged. An actual
  Agent container restart followed by the panel's accepted restart action and a
  fresh completed connection status retained the same epoch and counters; another
  two polling intervals still did not charge the bytes again.
- All eight labelled fixture containers and their internal network were removed.
  The original 16 container IDs and PDF HTTP 200 were unchanged. Private evidence
  remains on the VPS; credentials and subscriber configuration are not committed.

This uses `EXTERNAL_IMPORT` for creation and manually mounts persistent Agent
state in an isolated namespace. It is **not** managed creation, installer,
browser, UDP, public website/ACME, or power-loss acceptance. Earlier attempts
exposed orchestration mistakes (DNS namespace, numeric user identity, required
restart body and empty accepted response); only the final successful run above
is the complete end-to-end checkpoint.

## Installer follow-up (not yet deployed)

The public-direct installer now explicitly sets `ANYTLS_ENABLED=true` and
`ANYTLS_STATE_DIR=/var/lib/remnanode/anytls` and mounts the named
`remnanode-state` volume at `/var/lib/remnanode`. Its existing, more-specific
edge-directory mount and HAProxy socket volume are unchanged. Neither sidecar
receives the private AnyTLS state volume. Leased-line and residential installers
do not enable AnyTLS; panel-only, checksum-verified downloads and `pull_policy:
never` remain in place.

Local installer/unit/type checks passed (the two Linux-only shell suites are
skipped on Windows). Backend commit `2b2cebc4d86441405710cb39705c61bbbc7b55c4`
passed CI 33963996525, including actual Linux Bash/curl execution, and paired image
33963996595 with frontend `a0c76738`. Image digest:
`ghcr.io/fengyuchen1314/backend@sha256:4d9eca064de3d5f0389bcd34d135b912d0592d28a30b22a48bb75be7b05fff5a`.
The real panel-only installer/container-replacement test is in progress separately.
This does not upgrade
existing Agents, enable the managed-creation UI, or establish volume persistence
under an actual installer-created container replacement.
