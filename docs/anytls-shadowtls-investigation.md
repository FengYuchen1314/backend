# AnyTLS + ShadowTLS: security gate before implementation

Status: the native-Mihomo security proof and an **opt-in Node Agent runtime** now pass native
tests. Backend-managed creation, production subscriptions and shared-443 integration are still
not connected or advertised as usable. The user explicitly requires **Clash Verge / Mihomo only**.
Implementation is on Node's `wip/shared-443-node`, not the older AnyTLS-named worktrees.

ShadowTLS's [official documentation](https://github.com/ihciah/shadow-tls#how-to-use-it) states that
the protocol does not encrypt payloads and should be combined with an encrypted proxy.

Mihomo v1.19.30 has both server and client support for an inline AnyTLS/ShadowTLS combination, but
source inspection shows that this path replaces ordinary TLS rather than retaining it:

- [AnyTLS server](https://github.com/MetaCubeX/mihomo/blob/ac017cdd246ce8bd547653d927e7bf77d7ee73d5/listener/anytls/server.go)
  makes certificate-based TLS and ShadowTLS mutually exclusive and wraps the listener with one.
- [Transport selection](https://github.com/MetaCubeX/mihomo/blob/ac017cdd246ce8bd547653d927e7bf77d7ee73d5/transport/vmess/tls.go)
  returns the ShadowTLS connection directly when that mode is selected.
- [AnyTLS client](https://github.com/MetaCubeX/mihomo/blob/ac017cdd246ce8bd547653d927e7bf77d7ee73d5/transport/anytls/client.go)
  writes AnyTLS authentication/framing to that connection.
- [ShadowTLS v3 records](https://github.com/MetaCubeX/mihomo/blob/ac017cdd246ce8bd547653d927e7bf77d7ee73d5/transport/shadowtls/v3.go)
  add a record header/HMAC to application payloads; this is not payload encryption.

Therefore the presence of upstream support or passing connectivity tests is not sufficient to
offer that inline combination as an encrypted proxy. This source finding has now also been
reproduced with an isolated positive-control wire capture using unmodified Mihomo v1.19.30.

## Verified client-compatible construction

Use a normal, TLS-encrypted AnyTLS outbound as the visible node. Its `dialer-proxy` points at a
private AnyTLS/ShadowTLS-v3 transport wrapper. The wrapper's server can reach **only the exact
loopback TCP address/port of the inner TLS listener**; all other destinations are rejected.
The inner listener requires its own certificate verification and subscriber authentication.
Thus the wrapper carries actual TLS records instead of application plaintext. There is an extra
AnyTLS layer, so no "best performance" claim is justified by this proof.

No modified client or sing-box client is required. The tested client is the official Mihomo
v1.19.30 binary at source commit ac017cdd246ce8bd547653d927e7bf77d7ee73d5. A minimum supported
Mihomo core version must be documented and checked when this becomes a managed feature.

The proof is in the Node repository: `scripts/anytls-shadowtls-security.mjs`, certificate fixture
and portable VPS scripts. Its initial normal-path failure was a test-fixture routing mistake:
the camouflage-handshake dialer followed the global reject rule. Explicitly selecting DIRECT for
that fixed, owned fixture endpoint fixed it. Inner/outer servers are separate runtimes; Mihomo's
loopback detection is not disabled.

Node b5589cd passed [GitHub Actions](https://github.com/FengYuchen1314/node/actions/runs/33921734968)
and an isolated VPS run on 185.99.135.224: 10 scenarios plus their parent test, no skips. The
native inline positive control exposed request/response markers; the encrypted variant delivered
both directions without exposing those markers. Wrong inner trust anchor, inner certificate name,
inner password, ShadowTLS password and outer trust anchor all failed closed. IP/hostname wrapper
bypass attempts were rejected; valid encrypted traffic still worked after the negative cases.

The fixture pins a private CA **included after the leaf in the certificate chain**, not just the
leaf. In Mihomo's verifier, a matching CA triggers chain/expiry/hostname checks; a matching leaf
pin alone does not perform those same checks. Production certificate issuance, rotation and
trust-anchor distribution remain to be implemented. Private test keys must never be shipped.

## Server accounting and remaining integration gates

Mihomo's ordinary connection API discards closed connection trackers; polling it is not a
cumulative per-user billing solution. The current next proof uses an inner sing-box **server**,
retaining Mihomo as the only client. Its upstream AnyTLS handler propagates the authenticated
username to the v2ray statistics service, which retains cumulative counters after flows close.
The official v1.14.0 release binary omits that API and was correctly rejected by native config
validation. A GitHub Actions-only build of unchanged, pinned v1.14.0 source with
`with_v2ray_api` now passes native Mihomo interoperability, closed-flow accounting, user isolation,
counter reset and user-removal tests. Node 1925624 passed
[CI](https://github.com/FengYuchen1314/node/actions/runs/33922123525) and the same 14 tests (including
their parent) on 185.99.135.224 using the Actions artifact. Its archive SHA-256 is
`262a3af13cbbf530c33f8ec83ab34930648575e3e035b95d577ac6b4bccdd4ab`;
the private fixture directory is `/opt/xboard-anytls-test.t6QooXFl`. No production SDK or managed
runtime has been replaced, and this is not persistent accounting across Agent/process crashes.

The expanded proof at Node 5f32667 additionally rejects an incorrect outer AnyTLS password and
plaintext sent through the wrapper to the allowed inner TLS port. It passed
[CI](https://github.com/FengYuchen1314/node/actions/runs/33922409927) (13 Mihomo-inner tests,
16 accounting-server tests, including parents) and all 16 accounting-server tests on the VPS.
Actions artifact SHA-256:
`d549b9a3e3491704674023458256f5a6e9f8c38b68de8867d29b21efc6b7d96a`;
private fixture directory `/opt/xboard-anytls-test.vEeHlL09`. The disposable container was removed.

Node b027eb9 adds strict config/certificate checks, independent supervised core processes,
serialized reload/rollback, managed user/listener removal, durable cumulative totals and billing
baselines, explicit-stop persistence and graceful Agent restart. It is default-disabled and
exposes a JWT-protected `/node/anytls` API that the backend does not yet call. Native clients
cannot reach local management APIs. The supervisor is tested against Agent death and its own
SIGKILL; no unowned PID is killed. This does not prove lossless accounting on hard crashes: the
last uncheckpointed traffic can be lost, and panel delivery acknowledgements are not implemented.

It passed [CI](https://github.com/FengYuchen1314/node/actions/runs/33924956212) and all 24 combined
security/managed-runtime tests on 185.99.135.224 using only Actions-built artifacts, with no skips.
Archive SHA-256: `dadc319d42c1336cf8e87cd5b009bfcb5a318a24e275c9d2111599e353b4ae90`.
The private fixture directory is `/opt/xboard-anytls-test.AmVTMJLu`; no public port or existing
service was changed. This is compiled runtime-class acceptance, not full HTTP/JWT API acceptance
or acceptance of the newly built complete Node image. See Node's docs/anytls-security-proof.md.

Before exposing managed creation, complete:

- Backend start/stop/reconciliation wiring and aggregation with simultaneous Xray user statistics,
  preserving unbilled deltas on partial failures and defining delivery/crash semantics.
- Full API and complete-image acceptance of the opt-in runtime, including coordination with
  existing Xray start/stop/edge behavior. Private listeners/control interfaces stay loopback-only.
- Shared-443 routing. Neither inspected Mihomo listener configuration nor current sing-box
  accepts the existing VLESS PROXY-v2 path as-is; do not blindly forward that header.
- Subscription generation with private dependencies. Topology cloning currently replaces a
  node's `dialer-proxy`; it must retain this mandatory encryption wrapper and attach upstream
  topology hops to the wrapper, never silently remove the inner TLS or expose wrapper-only nodes.
- Certificate lifecycle, UI validation, user entitlements and full panel/API/Agent acceptance.

The user has now offered one mainland VPS. Its SSH host key differs from the locally saved
identity, so no probe has run pending independent identity confirmation. Foreign VPS tests are
not evidence of mainland reachability or GFW bypass. A single mainland vantage point will still
not establish nationwide availability or satisfy the existing two-distinct-ASN automatic gate.
