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
  passed all checks and compilation. The exact paired image and deployed checks
  are recorded below.

## Accepted managed installer and browser — 2026-09-05

[Paired image 33964860911](https://github.com/FengYuchen1314/backend/actions/runs/33964860911)
passed with backend `0b5125d12d4ddbaeacdd3d4a6fb93f2b9be158ce` and frontend
`1addfa954455333a236abb68d60575e6ed773540`:

`ghcr.io/fengyuchen1314/backend@sha256:76f018cab44b52ac110e7fcd57d414362e0ab6f3825f53dbfb6546c9d729ef00`

The original installer acceptance script at `970a6770` ran in **managed** mode
on 185.99.135.224, in `/opt/xboard-anytls-bootstrap.f7xNvTfI` (exit 0):

- The fresh panel's unchanged install command delivered all Agent/edge images
  through the panel to an empty private Docker engine with registry access cut
  off. Outbound access was enabled only after verifying panel-only installation.
- The real public API admitted `creationMode: MANAGED`, started encrypted AnyTLS
  and generated the untouched Mihomo subscription. Native Mihomo carried TCP
  through shared port 443 with both inner certificate pinning and outer public-CA
  verification enabled.
- Scheduled billing recorded 957 raw bytes as 478 charged bytes at multiplier
  0.5, with node multiplier 2, history, lifetime traffic and cursor checked.
  Repeated normal polling did not duplicate usage.
- Original Compose force-recreated the Agent without a build or pull. The new
  container kept the same named state volume, epoch, counters and billed totals.
  A subsequent request reached 1,911 raw / 955 charged bytes, retaining fractional
  carry correctly; repeated polling again left totals unchanged.
- All six owned outer containers, their internal network and nested image/state
  volume were removed. The original 16 container IDs and PDF HTTP 200 survived.
  This engine had no host Docker socket, host network/PID/ports or user-data mounts.

Separately, only the existing owned browser panel in
`/opt/xboard-panel-test.oKbMNrzT` was upgraded, after a private PostgreSQL backup.
The real production entrypoint preserved all 2 topologies, 5 complete profiles
and 4 hosts by deep comparison. Other container IDs and PDF HTTP 200 were unchanged.
The authenticated browser exercised the exact deployed frontend over its SSH tunnel:

- The AnyTLS preset disabled Create for missing camouflage fields and colliding
  private ports. Valid input created the isolated `Browser Encrypted AnyTLS`
  profile, UUID `c98f5d4d-5f47-4c09-aadf-9d3758179490`.
- Read-only API checks confirmed one strict listener, no embedded identities or
  transport secrets, empty native Xray inbounds and one synthetic TLS/443 inbound.
  The candidate SNI was `lax1.vultrobjects.com` with observed IP `149.28.85.11`;
  this observation is not verified-pool or mainland-wide evidence.
- After the real WASM loaded, the editor reported combined Xray/encrypted-AnyTLS
  structural validity. Whitespace editing enabled normal Save; Undo disabled it.
  Invalid JSON and a JSON-valid unsupported extension version separately disabled
  normal Save. The test drafts were discarded without saving; Save Anyway was
  not invoked.
- Public-direct selection exposed the encrypted AnyTLS/ShadowTLS inbound on 443.
  Leased selection showed only the existing Mieru profiles; residential selection
  showed only SOCKS5. The creation wizard was cancelled without generating a
  bootstrap credential or creating an extra Node.
- Final API comparison found exactly the one new profile; every previous complete
  profile, topology and host remained unchanged. Private evidence includes
  `managed-anytls-upgrade.log`, `managed-anytls-before.sql`,
  `managed-anytls-preservation.json` and `managed-anytls-post-browser.log`.

No application or native build ran locally or on the VPS. These checks do not
establish UDP, simultaneous VLESS/AnyTLS/website traffic, public ACME, full protocol
topology interoperability, or crash-proof lossless accounting. The earlier
`2b2cebc4` installer image remains an independent external-import checkpoint.
