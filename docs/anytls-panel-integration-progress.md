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
