# Managed encrypted AnyTLS creation

The existing profile/inbound/host structure remains in use. Managed public-direct
creation now recognizes only the synthetic AnyTLS inbound produced by the strict
`xboardAnyTls` profile extension: TCP, TLS, public port 443, matching tags and valid
distinct private ports. Residential servers remain SOCKS5-only; leased lines remain
Mieru-only. Existing external imports retain the explicit import path. Known
Cloudflare CDN names/IPs are rejected in the managed classifier as well as profile
validation; the Agent still independently checks live camouflage before admission.

Frontend commit `1addfa954455333a236abb68d60575e6ed773540` adds the encrypted
AnyTLS/ShadowTLS preset to the existing create-profile form and selector. It asks
for the camouflage SNI, target IP/TLS port and two private listener ports. It does
not embed subscribers, transport passwords, certificates, private keys or insecure
verification overrides. These remain panel-owned runtime material.

The existing editor validates the strict extension separately, removes it only
from the copy sent to Xray WASM, and keeps it in the saved profile. Root snippets
cannot inject an extension into the validation copy. Monaco receives a JSON-schema
hint derived from the same contract. Pure AnyTLS profiles retain their empty native
Xray inbounds and DIRECT outbound; mixed profiles keep the original native root.

Manual camouflage input is a candidate, **not** a verified region-pool choice or
proof of mainland reachability. Duplicate SNI/ports, physical-server topology
constraints and live DNS/TLS/Cloudflare checks remain backend/Agent gates.

## Source verification — 2026-09-05

- Frontend [CI 33964516594](https://github.com/FengYuchen1314/frontend/actions/runs/33964516594)
  passed 42 tests, changed-file lint, type checking and Actions compilation.
  The CI contract is pinned to backend
  `2b2cebc4d86441405710cb39705c61bbbc7b55c4`, rather than a moving older branch.
  The Actions-built contract artifact `9968999652` was installed locally without
  running package scripts; all 42 local tests and type checking passed. No
  application/contract build was run locally.
- Backend classifier commit `0b5125d12d4ddbaeacdd3d4a6fb93f2b9be158ce` passed
  its 8 local creation-policy tests, lint and type checking. Tests reject reserved
  or colliding ports, mismatched tags, private identity/user fields, non-TLS
  metadata, known Cloudflare CDN names/IPs and non-public server types.
- Backend [CI 33964860742](https://github.com/FengYuchen1314/backend/actions/runs/33964860742)
  passed all checks and compilation. Paired image 33964860911 is still pending at
  this source checkpoint and explicitly uses frontend `1addfa95`.

This source checkpoint is not deployed/browser/managed native-client acceptance.
The independent installer checkpoint uses backend `2b2cebc4` and the older accepted
editor UI; do not attribute managed creation to that image.
