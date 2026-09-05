# AnyTLS panel integration — 2026-09-05

This is a backend integration checkpoint, not complete AnyTLS product acceptance.
The managed creation whitelist and installer runtime flags are deliberately unchanged.
Mihomo encrypted subscription wrappers, topology wrapper dependencies, accounting,
creation UI, and a real mixed-protocol public-443 client test remain required.

## Implemented

- Native Xray JSON stays at the profile root. `xboardAnyTls` is a strict, versioned
  panel extension containing tag, two private ports, and camouflage SNI/IP/port.
  It is removed before native Xray validation and execution. Synthetic AnyTLS
  inbounds reuse existing profile, squad and Host associations; startup sync keeps
  their UUIDs. Mixed tag/SNI/port collisions and known Cloudflare CDN targets fail.
  Agent live DNS/TLS/CDN checks remain mandatory; static validation is not proof
  that a target has not moved onto Cloudflare or is reachable from mainland China.
- An inbound-owned `anytls_materials` table holds the private identity separately
  from profile/raw-inbound JSON. Concurrent workers use revision CAS. Deleting the
  inbound cascades its identity; rewriting display metadata does not rotate it.
  ECDSA P-256 private CA, 90-day leaf, exact inbound SAN, independent transport
  passwords, and inbound-specific subscriber password derivation are validated.
  Leaf renewal retains the CA pin. CA replacement near its 10-year lifetime needs
  an explicit migration; automatic CA rotation is not implemented.
- Preparation streams entitled users once and populates independent native and
  AnyTLS listener sets. The CA private key never enters the Agent request or the
  client identity view. Subscription identity reads never renew a leaf implicitly.
- Public-direct starts probe `/node/anytls/capabilities`; only HTTP 404 permits
  legacy fallback. Joint Agents receive both configs, including explicit empty
  AnyTLS removal. Legacy plugin synchronization is not sent in joint mode; active
  plugin assignments are refused. Bulk starts use the same single-node path.
- Shared-443 edge planning reserves both AnyTLS private ports and routes only to
  its wrapper, without PROXY v2. VLESS retains its own PROXY-v2 loopback listener.
  Unknown/extra/mismatched identities, SNI/web collisions and port overlap fail.
- User changes queue complete reloads for public-direct and AnyTLS nodes, including
  changes during a reload and removal of the last entitlement. Legacy hot-update
  behavior is retained for other servers. Unexpected preparation errors clear the
  connecting flag without logging private configuration details.

## Verification scope

Local checks run TypeScript, unit tests and lint only. Application/test bundles are
compiled by GitHub Actions. Both CI and image publication test the new migration
and concurrent identity updates on disposable PostgreSQL.

`scripts/anytls-panel-acceptance.ts` bundles the actual preparation, PKI, edge,
queue, permission and seed tests for isolated VPS replay. Its TLS test validates
the generated chain and SAN on a real local TLS socket. Queue tests mock the Agent
API: they do **not** prove encrypted AnyTLS/ShadowTLS/Mihomo proxy traffic, public
ACME issuance, billing delivery, or certificate rollout to all physical replicas.

Daily renewal queues expiring profiles 30 days before leaf expiry. Ordinary Node
health/retry handling applies to failed starts; per-replica certificate deployment
acknowledgements and crash-proof usage acknowledgements remain follow-up work.

## Accepted checkpoint

Functional commit: `60cb162d7375264ec2cf38e22fdfd007f3d9610f`.

- [CI 33956872526](https://github.com/FengYuchen1314/backend/actions/runs/33956872526)
  passed, including application/dependency wiring, the new PostgreSQL migration and
  CAS test, existing native Mihomo/sing-box topology checks, and the compiled test bundle.
- [Paired image 33956974921](https://github.com/FengYuchen1314/backend/actions/runs/33956974921)
  passed for amd64/arm64 with frontend `db3fc697571735f5dc38ac1044d9c96ad676566c`.
  The automatic build defaulted to the older `xboard-dev` frontend; the explicit
  paired build replaced it. Verified immutable image:
  `ghcr.io/fengyuchen1314/backend@sha256:429d75ac4838702ff9fe9e00b659b97fe7fb4ace331561dc01cfb9f2ab9037d1`.
- On **185.99.135.224**, `/opt/xboard-anytls-panel-test.FFtScMz7` retains the verified
  artifact and logs. **30/30**, zero skips, passed first with the prior production
  dependency runtime and again with the new image. Full new-image migrations and
  the compiled PostgreSQL CAS/FK/metadata-isolation test then passed (**1/1**).
- Artifact `9966669846`, GitHub ZIP SHA-256
  `97dc815c2e68445c5b12d3b622aefe25f970628b7fea84438ae96bc797fabb10`;
  inner tar SHA-256
  `96239cac0171206d358c2ccc4a5c0995a2aacbc4f28c3a3f9cfdd5fedbd56249`.

The first database helper mistakenly treated PostgreSQL's temporary initialization
Unix socket as final readiness, then saw connection rejection during its restart.
That attempt did not pass. The corrected helper waits on `127.0.0.1` TCP; accepted
logs are `preparation-new-image.log` and `database-tests-tcp-ready.log`.
The exact VPS helper SHA-256 was
`a0ed66e1a687b5add98d83977cf6644ed7b3c530384ac2e8c2c7b3094050febc`.
`scripts/vps-anytls-panel-db-smoke.sh` retains the helper with a reusable commit
check: the image revision must match the bundle's `SOURCE_COMMIT`.

Temporary test containers, the internal database network and tmpfs database were
removed. Existing panel/PDF/proxy containers were not upgraded or removed. These
results do not promote any camouflage domain to mainland-verified status or enable
AnyTLS creation before subscription, topology and accounting integration.
