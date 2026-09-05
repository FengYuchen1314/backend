# Encrypted Mihomo subscription integration — 2026-09-05

This follows the accepted panel preparation checkpoint `60cb162d`. Managed creation,
installer flags, accounting integration, live-panel rollout and public shared-443
acceptance are still pending. The isolated native subscription checkpoint below
has passed; this does not enable the unfinished managed product workflow.

## Implementation

- The resolver reads an existing, validated inbound identity without renewing it.
  It derives the same per-user password as Agent preparation. Private CA/leaf keys
  and certificate bodies do not enter the resolved subscription model. Missing
  identity, mismatched inbound/SAN, known Cloudflare CDN and unsafe Host overrides
  omit the managed Host. Custom remark JSON cannot fabricate managed AnyTLS.
- Each logical Mihomo node has an outer AnyTLS + ShadowTLS v3 transport and an
  inner TLS-encrypted AnyTLS connection. The outer connection validates the
  camouflage site's public certificate and SNI. The inner connection pins the
  panel's private CA, so chain, expiry and the exact inbound SAN remain verified.
  These are independent trust domains; the inner CA is never the outer pin.
- Graph patches apply only to the network-facing transport. Required inner
  dependencies stay intact for chains and many-to-one balances. Failed members
  omit the whole composite, including all helper transports. Ordinary Hosts and
  independent graphs retain separate names and credentials.
- Helpers remain addressable by `dialer-proxy`, but selectors, include-all groups,
  generated provider payloads and explicit GLOBAL membership exclude them. A
  generated provider with nonempty overrides omits managed AnyTLS rather than
  letting client-side overrides remove its required dependency. Other Hosts remain.
  Subscribers necessarily receive wrapper credentials; this is not a claim that
  they cannot edit their own config. The Agent's exact inner-port ACL remains required.
- Stash, legacy Clash, sing-box and Xray subscription exports omit this managed
  AnyTLS construction; they never emit an unencrypted substitute. Native existing
  protocols and sing-box topology behavior are retained.

Mihomo references: [TLS dispatch with ShadowTLS](https://github.com/MetaCubeX/mihomo/blob/v1.19.30/transport/vmess/tls.go),
[CA fingerprint chain/SAN verification](https://github.com/MetaCubeX/mihomo/blob/v1.19.30/component/ca/fingerprint.go),
[built-in GLOBAL](https://wiki.metacubex.one/config/proxy-groups/built-in/),
[provider filtering and overrides](https://wiki.metacubex.one/config/proxy-providers/).

## Verification

Unit tests exercise the actual resolver, generator and graph boundary. Actions
compiles `anytls-clients.test.cjs` and runs official checksum-pinned Mihomo 1.19.30
and sing-box 1.14.0. The native fixture uses two independently generated CAs; only
the camouflage CA enters the **test child process** trust store. It checks ordinary
and inline-provider subscriptions, SOCKS → AnyTLS, AnyTLS → SOCKS, balanced ingress,
wrong inner/outer names, CA pins and passwords, wire markers, and renewed leaves.

The balance fixture disables AnyTLS reuse only on its test config to force multiple
transport sessions and observe both branches. Production keeps normal AnyTLS
session pooling: balancing chooses connections, not every multiplexed request.
These tests cover TCP. UDP, public ACME, billing delivery and cross-physical-server
rollout are not established by this isolated loopback proof.

`scripts/vps-anytls-subscription-smoke.sh` replays the Actions-compiled bundle with
the accepted backend dependency image. It uses no host network, published ports,
Docker socket or existing panel state. Test configs and private PKI live only in
the disposable container's tmpfs. The script refuses an existing named container.

## Accepted source/native checkpoint

Functional commit: `cce23429e53af4ca72a31bc963665e3e3d36bae9`.

- [CI 33959392586](https://github.com/FengYuchen1314/backend/actions/runs/33959392586)
  passed all source checks, PostgreSQL tests, application build and dependency/API
  wiring. Native AnyTLS tests passed **15/15, zero skips** both from source and
  from the Actions-compiled portable bundle. Existing native topology tests passed.
- Artifact `9967468355`, `topology-acceptance-cce23429e53af4ca72a31bc963665e3e3d36bae9`.
  ZIP SHA-256: `c6e5bd363abab3c4a33a17fb9c48ad06a7cc0af3f9bae7f6d96c366b216b64a5`.
  Tar SHA-256: `f2cddd050cfe44240e1e81d2a73e2f13863137682020cecda4e13fa50619f0b1`.
- VPS `185.99.135.224`, `/opt/xboard-anytls-subscription-test.1i2l5xxx`:
  **61/61 tests passed, zero skips** (15 native AnyTLS, 36 panel/identity/generator,
  10 existing native topology). `acceptance.log` records the replay. The container
  was removed; all original 16 container IDs stayed unchanged and both PDF services
  remained healthy, with HTTP 200 on port 38100. No live panel was upgraded.
- [Paired image 33959392932](https://github.com/FengYuchen1314/backend/actions/runs/33959392932)
  uses frontend `db3fc697571735f5dc38ac1044d9c96ad676566c`. Validation and frontend
  compilation passed; image packaging/publication was **still running** when this
  checkpoint was written. Do not infer an accepted image digest from this note.

## Accounting boundary still to implement

`RecordUserUsageQueueProcessor` currently polls only native Xray `getUsersStats`
with `reset: true`. Node's AnyTLS `/stats` also advances its durable `billed` cursor
before returning a reset response. Simply adding that reset response to the old
Redis/queue pipeline would lose usage when the response or subsequent enqueue is
lost, and could double-count retried database updates. It is not integrated yet.

A bounded next implementation is a durable, non-reset AnyTLS cumulative snapshot
with a stable ledger epoch, plus a per-physical-node database watermark updated
in the **same transaction** as user traffic and raw node/user history. It must
handle duplicate/out-of-order polls, node restarts, counter rollover/ledger changes,
deleted users and integer precision. Keep existing native accounting behavior
separate; do not bill wrapper bytes as another subscriber connection. Crash loss
before a core counter is durably sampled still needs an explicit, honest bound.
