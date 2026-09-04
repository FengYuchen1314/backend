# AnyTLS + ShadowTLS: security gate before implementation

Status: investigation only. This protocol has not been added to managed creation or advertised as
usable. Existing AnyTLS-named worktrees contain no AnyTLS implementation.

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
offer that inline combination as an encrypted proxy. This conclusion comes from the above source
paths; no packet-capture confidentiality test or secure replacement implementation has been made.

Next investigate keeping actual, verified TLS inside an outer ShadowTLS transport (for example,
using sing-box's standalone ShadowTLS detour). Confirm server/client interoperability, certificate
trust distribution, user revocation, cumulative per-user billing and shared-443 PROXY-v2 handling.
Client formats unable to express the verified secure combination must report unsupported, not
silently drop TLS or substitute an unencrypted mode. Do not claim a performance advantage without
measurements. The user's no-mainland-probe limitation continues to apply to camouflage domains.
