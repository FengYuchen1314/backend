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

Local unit tests, TypeScript checking and lint passed. New PostgreSQL tests cover
concurrent duplicates, out-of-order delivery, fractional charging, rollback and
retry, physical-node scoping, new epochs, counters above JavaScript's safe integer
range, disabled optional history and deleted users. Actions and VPS execution of
these database tests are pending at this implementation checkpoint.

Managed creation, installer enablement/state mounts, complete native-client to
real-panel accounting and live-panel rollout remain separate acceptance work.
