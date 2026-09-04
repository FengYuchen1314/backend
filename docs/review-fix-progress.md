# Review remediation checkpoint — 2026-09-05

This remains a WIP integration, not a deployable complete release. Passing these checks does not
finish the original eight requirements. The active remediation objective is not complete.

## Branches and verification

- Backend: wip/shared-443-backend, functional checkpoint afab00ff.
- Frontend: wip/shared-443-ui, checkpoint f9db2164 (based on 07c0a579).
- Node: wip/shared-443-node, checkpoint d7a4fd7.
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

[Paired build](https://github.com/FengYuchen1314/backend/actions/runs/33915931367) was explicitly
requested for backend afab00ff + frontend f9db2164. Its validation and exact-contract frontend build
passed; inspect the final Docker build outcome before claiming image success.

## Implemented connections

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

## Still required

- AnyTLS + ShadowTLS runtime, managed creation, subscriptions and shared-443 integration.
- Deliver every Agent artifact/image through the panel instead of direct registry/download access.
- Full panel/API/Agent/browser acceptance for reverse-proxy management, actual shared-443 Xray
  traffic, public certificate issuance, restarts and recovery. See node-edge-settings.md.
- Activate saved topologies in real subscriptions, preserve client-format semantics, enforce exact
  host/physical-node ownership and test chains/load balancing using actual clients.
- Expand three individual discovery seeds per region into the requested distinct domain pools.
  The user has **no mainland probe machine/interface**. Keep candidates unverified and verified
  automatic selection unavailable. Do not claim GFW reachability from overseas VPS evidence.
- Browser regressions for dirty topology refresh/save, cached Mieru initialization, and new
  reverse-proxy draft/revision controls.
- Full panel database/API acceptance, final paired image build/publication and review of every
  original requirement, including update/bootstrap end-to-end checks.

Do not mark remediation complete until these remaining items have direct evidence.
