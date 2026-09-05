# Review remediation checkpoint — 2026-09-05

This remains a WIP integration, not a deployable complete release. Passing these checks does not
finish the original eight requirements. The active remediation objective is not complete.

## Branches and verification

- Backend: wip/shared-443-backend, functional checkpoint 88fcdb69.
- Frontend: wip/shared-443-ui, checkpoint 74acd0f3.
- Node: wip/shared-443-node, runtime checkpoint d7a4fd7; AnyTLS security/accounting proof 5f32667.
- Published/tested Mieru Node image: fbf271d, digest
  sha256:80e27e701376c14e04aba349bebb8c8d23ee0c7a9feca5442ed27223c7af090e.

WIP builds do not change deployment tags. The published Mieru-only image does not contain the
new public-direct edge runtime.

Backend afab00ff passed 68 existing tests plus 5 edge-settings tests in GitHub Actions, including
actual PostgreSQL migrations, concurrent creates/updates, stale revision rejection, metadata
replacement and Node deletion cascade. Build and OpenAPI startup checks passed.
[Backend CI](https://github.com/FengYuchen1314/backend/actions/runs/33915908707).

Node d7a4fd7 CI passed; local tests had 56 passes and two Linux-only skips. GitHub Actions separately
runs the real Linux Mieru lifecycle and HAProxy/Caddy integration tests.
[Node CI](https://github.com/FengYuchen1314/node/actions/runs/33915903874).

Frontend f9db2164 passed local typecheck, changed-file lint and 22 existing tests, plus the complete
[frontend CI build](https://github.com/FengYuchen1314/frontend/actions/runs/33915899190).
Full upstream lint still reports unrelated existing React rules; CI checks changed files.
The new interface has not yet had browser acceptance.

[Previous paired build](https://github.com/FengYuchen1314/backend/actions/runs/33915931367) passed
for backend afab00ff + frontend f9db2164, including the final Docker build. That image does not
include the newer topology publication work.

Backend 88fcdb69 passed [CI](https://github.com/FengYuchen1314/backend/actions/runs/33919053163):
68 existing tests, 8 new subscription/publication tests, 5 edge-settings tests, PostgreSQL topology
publication concurrency/defaulting, 9 native-client scenarios and the same 9 scenarios using the
Actions-compiled portable test bundle. Backend compilation and OpenAPI dependency wiring passed.
Frontend 74acd0f3 passed [CI](https://github.com/FengYuchen1314/frontend/actions/runs/33918719374),
including its 22 tests and production build. Browser acceptance is still outstanding.

The [new exact paired image build](https://github.com/FengYuchen1314/backend/actions/runs/33919348040)
targets backend 88fcdb69 + frontend 74acd0f3. Validation, the paired frontend build and the final
multi-architecture Docker build all passed (completed 2026-09-04 21:20 UTC). WIP tags are not
published; this confirms compilation, not deployment or browser acceptance.

## Implemented connections

- The user now targets Clash Verge / Mihomo only. A native-Mihomo AnyTLS + ShadowTLS security
  proof retains verified inner TLS and restricts its outer wrapper to the exact inner listener.
  Node 5f32667 passed [CI](https://github.com/FengYuchen1314/node/actions/runs/33922409927): 13 tests
  with a Mihomo inner server and 16 with an Actions-built sing-box inner server, including their
  parent tests. Only the server varies; both variants use the official Mihomo client. Plaintext
  positive control, certificate/password failures, wrapper bypass, closed-flow cumulative user
  accounting, counter reset and removed-user rejection are covered. This is a proof harness,
  **not** managed protocol creation or a deployed Agent runtime; see anytls-shadowtls-investigation.md.
- Preserve managed server-type restrictions and external imports. Mieru/SOCKS changes use their
  correct runtime reload/stop paths, including profile deletion and failed-stop reporting.
- Backend now prepares ISOLATED_LISTENERS by inbound UUID and per-user entitlement. One physical
  server runs separate Mieru daemons with private configuration, sockets, PID tracking and dumps.
- Serialized reconciliation persists desired state, rolls back partial starts, stops deleted
  instances and revokes sessions before replacing users. Agent exit stops owned children.
  Explicit stop persists null first, so later restart cannot revive stopped listeners.
- Metrics baselines are per instance/user before aggregation, survive Agent restarts and retain
  retired-instance counters. The first statistics poll establishes a migration-safe baseline.
- Leased-line bootstrap uses embedded Mieru and persistent state without a Docker socket.
- Shared-443 planning rewrites managed VLESS REALITY to stable loopback ports; it rejects duplicate
  SNI, reserved ports and website/self-loop conflicts. HAProxy sends PROXY-v2 to proxy listeners.
- Node edge API and core-start path now journal/reload HAProxy/Caddy and attempt coordinated
  rollback. Unconfirmed rollback is an error. Caddy listeners are private and website HTTP requests
  redirect to HTTPS. Origin protection remains enabled; the Agent sends its local Origin.
- Real HAProxy/Caddy CI tests cover two SNI routes, PROXY-v2, rejected reload/recovery, website
  reverse proxy and 308 redirects. Fixed Caddy empty-site port conventions and missing Origin
  headers discovered by those tests.
- Administrator-only reverse-proxy APIs use a panel-owned node_edge_config table with revision
  checks. Agent metadata replacement cannot overwrite it. The node editor keeps conflicting
  drafts and separates saving from applying; a queued restart is not runtime success.
- Prior fixes remain: topology draft revisions do not advance with background refresh; chain
  direction and many-to-one branch membership corrected; Mieru edit fields follow watched values.
- Explicit publication now feeds authorized complete graphs into the normal Mihomo/sing-box
  subscription generators. New/legacy graphs stay drafts, ordinary nodes are not mutated, private
  clone tags prevent cross-graph collisions, and unsupported members/strategies omit the full graph.
  Published Hosts require unique enabled physical-Node bindings. Revision-locked publication is
  tested against PostgreSQL, including eight concurrent writers and stale unpublish/delete attempts.
- Real authenticated TCP tests verify Mihomo two-hop chains and round-robin entrances sharing one
  exit, plus sing-box two-hop chains. Health probes use an independent isolated fixture; blocked
  default probes had marked both entrances dead and caused first-member fallback. Also fixed a
  test-fixture FIN race that could truncate healthy HTTP responses. Each scenario now runs three
  times and requires eight real requests. See subscription-topology-publication.md.
- Paired builds compile a pinned frontend against the exact backend contract. OpenAPI generation
  checks module/guard wiring. URL types and missing CqrsModule imports were fixed.

## VPS evidence and preservation

On 185.99.135.224, the Action-built fbf271d image was tested in a disposable bridge-network container
with no published ports or Docker socket. Fresh short-lived mTLS certificates, JWT keys and random
test credentials stayed in a private directory. The pinned upstream Mieru 3.36.0 client archive was
SHA-256 verified; nothing was compiled on the VPS.

Real client traffic confirmed: two working listeners, cross-listener credential rejection, a
single aggregated record per shared user, user replacement, listener deletion, graceful Agent
restart/config restoration, persistent baselines without replaying billed traffic, fresh traffic
after restart, explicit stop and no revival after another restart. Reproducible scripts are in
the Node repository: scripts/vps-mieru-smoke.sh and scripts/vps-mieru-smoke.mjs.

PDF services and /opt/pdfmathtranslate-next were not modified. The web endpoint returned HTTP 200
and both PDF containers remained healthy. Old proxy/MMW services were not removed. Completed test
scripts remove their disposable containers; private test files remain for diagnosis.

The Actions acceptance artifact for backend 88fcdb69 was additionally run on this VPS at
2026-09-04 21:06 UTC (2026-09-05 05:06 Asia/Shanghai). Its archive SHA-256 was verified locally
and again remotely:
`212ed676ab8b4ce807ba89821c2761134be49911c5407f067799be0d817e6fde`.
All 9 native-client topology tests passed (3 scenarios × 3 repetitions, 8 requests each).
The bundle is retained at `/opt/xboard-topology-test.3RuPbolm`; its disposable container was removed.
It used the existing backend runtime image digest
`sha256:f1591532bdfd3c3ecf38cf098b78946c8de2224001070e91584e22de6bba5bd3` (runtime base 91b5167)
only for Node/dependencies, with the new generator/compiler code from the 88fcdb69 test bundle.
No panel process/database was started. Networking was limited to container loopback, with no host
ports or Docker socket. Afterwards both PDF containers remained healthy and HTTP 38100 returned 200.

The Actions AnyTLS security/accounting artifact from Node 5f32667 was also verified locally and
on this VPS, SHA-256 `d549b9a3e3491704674023458256f5a6e9f8c38b68de8867d29b21efc6b7d96a`.
All 16 tests (including the parent) passed with the official Mihomo client, a Mihomo outer
wrapper and an Actions-built, pinned sing-box inner server with cumulative statistics enabled.
The test included plaintext-control/inner-TLS wire capture, certificate/password failures,
wrapper and plaintext-inner bypass rejection, closed-connection user accounting/isolation,
counter reset and removed-user rejection after process replacement. No core was compiled on
the VPS. The private test directory is `/opt/xboard-anytls-test.vEeHlL09`, its disposable container
was removed, and there were no host ports, Docker socket, host-network access or panel processes.
This is still a protocol proof, not an AnyTLS-capable managed Node image.

## Historical remaining work at the opt-in runtime checkpoint

This section is retained as historical context, not the current completion list.
Later managed installer, accounting and browser acceptance is summarized below.

Update after the security-only checkpoints above: Node b027eb9 now provides an opt-in managed
AnyTLS runtime (default-disabled), with native configuration/certificate validation, supervised
cores, transactional reload/rollback, durable cumulative accounting and graceful restart. It
passed [CI](https://github.com/FengYuchen1314/node/actions/runs/33924956212) and all 24 combined
security/lifecycle tests on 185.99.135.224. Artifact SHA-256:
`dadc319d42c1336cf8e87cd5b009bfcb5a318a24e275c9d2111599e353b4ae90`.
The container was removed and both PDF services remained healthy (HTTP 38100 = 200). Backend
creation, subscriptions, mixed Xray billing, shared-443 and full API/image acceptance are still
outstanding; no public managed protocol option has been enabled. The next cleanup patch is not
part of that verified checksum. Hard-crash uncheckpointed accounting is not lossless.

- The user clarified that only Clash Verge / Mihomo client support is required. Existing sing-box
  output may remain, but new protocol acceptance must demonstrate native Mihomo interoperability.
- AnyTLS + ShadowTLS backend-managed creation/reconciliation, subscriptions and shared-443
  integration. The opt-in Agent runtime now passes native tests, but certificate lifecycle,
  simultaneous Xray billing, full API/image acceptance and topology-wrapper preservation are
  still required before exposing this option; see anytls-shadowtls-investigation.md.
- Deliver every Agent artifact/image through the panel instead of direct registry/download access.
- Full panel/API/Agent/browser acceptance for reverse-proxy management, actual shared-443 Xray
  traffic, public certificate issuance, restarts and recovery. See node-edge-settings.md.
- Full panel/browser acceptance of topology publication, actual multi-physical-host traffic and
  supported protocol-pair interoperability beyond the authenticated SOCKS5 TCP acceptance fixtures.
  Xray JSON/Base64/Clash/Stash graph output remains explicitly unsupported; sing-box does not
  silently emulate round-robin or consistent-hash semantics.
- Expand three individual discovery seeds per region into the requested distinct domain pools.
  The user independently verified the mainland VPS's changed SSH identity. Its read-only probe
  completed TLS 1.3/X25519/HTTP/2 requests to all 21 seeds, with no observed Cloudflare signals.
  The Cloudflare negative control was rejected before TLS. These are single-source discovery
  observations, not automatic eligibility. One network does not establish nationwide
  reachability or satisfy the current two-distinct-ASN automatic gate. See Node's
  docs/mainland-camouflage-probe.md; no existing service on the mainland VPS was changed.
- Browser regressions for dirty topology refresh/save, cached Mieru initialization, and new
  reverse-proxy draft/revision controls.
- Full panel database/API acceptance, final paired image build/publication and review of every
  original requirement, including update/bootstrap end-to-end checks.

Do not mark remediation complete until these remaining items have direct evidence.

## Additional checks after the opt-in runtime checkpoint

- Node ec632cf passed [CI](https://github.com/FengYuchen1314/node/actions/runs/33925806458), its
  [multi-architecture image build](https://github.com/FengYuchen1314/node/actions/runs/33925806431)
  and all 24 portable AnyTLS tests on 185.99.135.224. The new checks cover retired private-config
  cleanup. Artifact SHA-256: `b712ee555961e2235304d6a2d2b2ebc99c6934710f1665193d7b3ccece5e29fd`.
- Frontend 5df763b7 passed [CI](https://github.com/FengYuchen1314/frontend/actions/runs/33926419685),
  typecheck and 25 unit tests. Draft epochs now reject late save/publication/preview/reload
  responses after selection or local edits; deleted-but-edited drafts are retained. These are
  unit/build checks, not browser acceptance.
- The backend domain policy now independently checks Cloudflare IPv4/IPv6 ranges and reported
  signals, even when an Agent says `detected: false` or an older cache says `eligible: true`.
  Unknown provenance is not promoted by the new probe. Full managed start/edit-path enforcement
  and current authenticated probe ingestion remain part of the integration work.

## Current accepted checkpoint — 2026-09-05

The source/image-specific records below supersede historical pending claims;
they do not mark the whole screenshot scope complete:

- [Managed encrypted AnyTLS creation](anytls-managed-creation.md): exact backend
  `0b5125d1` / frontend `1addfa95` image passed Actions, real browser creation and
  validation, server-type filtering and original panel-only installation with
  `creationMode: MANAGED` on the test VPS.
- [Cumulative accounting](anytls-cumulative-accounting.md): real native Mihomo
  subscription traffic reached the scheduled panel worker, PostgreSQL and user
  API. Agent container replacement retained the named state volume and cumulative
  billing cursor; further traffic and repeated polling were verified.
- The Mieru/Xray editor loading, dirty-state and actual HTTP-failure/retry checks
  are recorded in the frontend's `docs/config-editor-runtime-loading.md`.
  Existing browser profiles/hosts/topologies were preserved across upgrades.

The major unclosed acceptance areas remain simultaneous VLESS/AnyTLS/website
shared-443 traffic, complete reverse-proxy/public-certificate behavior, full
cross-physical-server protocol/topology interoperability, the requested distinct
regional domain pools, one-click update/recovery and the final requirement audit.
Domain observations from the one supplied mainland network must be labelled as
such; they cannot establish nationwide reachability. The existing two-ASN pool
gate is implementation policy, not an additional user-provided acceptance
requirement. No new agent, public host port or change to existing PDF/MMW services
is implied by these outstanding checks.
