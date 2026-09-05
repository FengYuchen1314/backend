# Encrypted Mihomo subscription integration — 2026-09-05

This follows the accepted panel preparation checkpoint `60cb162d`. Managed creation,
installer flags, accounting integration, live-panel rollout and public shared-443
acceptance are still pending. Native acceptance below must pass in Actions and on
the isolated VPS before treating the generated subscription as accepted.

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
