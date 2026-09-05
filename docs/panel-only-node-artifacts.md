# Panel-only Node bootstrap artifacts

The installer no longer asks the target server to pull images from registries. The Xboard
image workflow exports the digest-pinned Node, HAProxy and Caddy images for both Linux amd64
and arm64 into Docker archives, verifies their image identities and records archive sizes and
SHA-256 hashes. Both architecture sets are included in each panel image, so a panel can deploy
either kind of server without depending on its own architecture. This increases panel image
size; no Docker socket, registry credentials or download proxy is added to the panel process.

`src/modules/nodes/node-bootstrap-images.json` is the reviewed source-image lock. The generated
manifest and archives live at `/opt/app/node-artifacts` and must ship together. Non-Xboard image
builds without these artifacts fail closed when asked to create a bootstrap command; they do
not silently fall back to registry downloads.

The existing admin-only bootstrap operation checks archive readiness, binds a five-minute
single-use token to the panel origin and catalog hash, then returns an installation command.
Redeeming it issues a separate one-hour artifact grant with at most eight requests per file.
Grants are hashed in Redis, are bound to the same catalog, and grant only Node archives for
leased-line/broadband servers or all three image roles for public-direct servers. Tokens are
sent in POST bodies, never URL paths or query strings. The server streams only closed-catalog
regular files through a no-store endpoint; filenames cannot choose arbitrary filesystem paths.

The target uses its Docker engine architecture to choose archives. All downloads must finish,
match their declared size and pass SHA-256 before any image is imported. Each imported image
must also match the expected config ID, Linux OS and architecture. Only then are credentials
and the existing Compose/edge templates written. Digest-derived local tags and `pull_policy:
never`, plus `compose up --pull never --no-build`, prohibit registry fallback. Docker supports
[loading compressed image archives](https://docs.docker.com/reference/cli/docker/image/load/)
and documents the [never pull policy](https://docs.docker.com/reference/compose-file/services/#pull_policy).

The command first downloads the complete installer to a private temporary file before running
Bash; a truncated response is not executed as a partial installer. Downloads do not follow
redirects or disable TLS verification. Existing installation files or named Node/edge containers
are rejected instead of being overwritten or removed. This is a first-install workflow, not
the separate update workflow. Docker, Compose v2, Bash, curl and sha256sum remain OS prerequisites;
the installer does not install or update the host operating system.

## Verification scope

Unit coverage includes catalog pinning/completeness, path traversal and non-regular-file checks,
scope/expiry/catalog-change authorization, bounded retries and installer wiring. The Linux test
executes the actual generated Bash with real curl and a local HTTP fixture; Docker alone is
stubbed to check side-effect ordering. It covers both architectures, corrupt/missing/redirected
downloads, a mismatched loaded image, existing installation preservation and a truncated entry
script. Windows explicitly skips the Linux cases; Actions must run them before image publication.

Actions image packaging, authenticated full-panel downloads and a real Linux amd64 public-direct
first install have passed the acceptance checks below. Arm64 execution and leased-line/residential
first installs are not established by that VPS test. The shell fixtures alone do not establish
Node health, shared-443 protocol traffic, Mieru traffic, AnyTLS integration or the panel update
workflow; the latest acceptance scope is recorded separately below.

Initial Actions checkpoint `610437ee`: all 84 ordinary tests passed on Linux with no skips,
including the actual Bash/curl failure scenarios. One CI run then failed in the existing native
Mihomo topology tests with intermittent socket termination; the image validation job passed the
same tests. A separate deterministic half-close regression exposed premature EOF in the SOCKS
test fixture (not production proxy code). Its correction passed ten local repetitions; native
CI is increased to ten repetitions per scenario to check the remaining intermittent failure.

The first image packaging job failed because Docker's classic image store cannot overwrite a
multi-architecture index digest with its other architecture. Packaging now resolves each Linux
child descriptor from the same pinned index and pulls that child digest independently. The
source lock remains unchanged. Neither failed run produced an accepted deployment image.

Revision `e76e9645` passed the full
[backend CI](https://github.com/FengYuchen1314/backend/actions/runs/33943307737): 84 ordinary
Linux tests with no skips, 31 native topology tests (ten repetitions per scenario plus the
half-close regression), database checks, application compilation and OpenAPI generation.
The Actions-compiled portable topology bundle then passed all ten tests on `185.99.135.224`.
Its SHA-256 was verified locally and remotely:
`1ab3516aef4480e2db17c9459fdd7f3aee27cf53ec6879606b3d5cc140a4ffcf`.
The private bundle directory is `/opt/xboard-topology-test.IqrzkjDo`; its disposable container
was removed. It used container-loopback networking only, no public ports or Docker socket.

The separate first-install fixture at `/opt/xboard-bootstrap-test.p8C9jmTr` was prepared with an
empty private Docker image store, an independent Docker data volume and only the internal
test-panel network. Registry egress was unavailable. A loopback HTTPS relay rejected clients
without its private trust anchor and succeeded with explicit CA verification. This daemon was
a temporary privileged test container, not a production deployment recommendation, without the host Docker
socket or host networking. Bash/curl were provisioned as test OS prerequisites before disconnecting
Internet access. At that checkpoint no Agent had yet been installed. Both PDF containers were
healthy and their endpoint returned HTTP 200.

The successful [paired image workflow](https://github.com/FengYuchen1314/backend/actions/runs/33943308182)
published backend `e76e9645` with frontend `db3fc697`. The accepted image digest is
`sha256:5fbb8308b159ae61ea50cb9c5ca1867b8a9ee6d3b4c7c8311fd234f8d6a362e2`.
Before replacing only the owned test panel, its source-pair metadata, runtime channel and all
six embedded archive hashes were verified. After replacement, both saved topology records and
the Mieru manual mapping/shared profile were preserved exactly. The real authenticated API
downloaded all six archives (390.3 MiB total), checking full sizes, hashes and response headers.
Replayed bootstrap tokens, invalid grants, cross-role downloads and path traversal were rejected.

Executing the API-generated installer on the registry-isolated Alpine engine then failed at
checksum verification: BusyBox `sha256sum` rejects GNU's `--check --status` options. No images
were imported and no Node credentials were written. The source now uses the portable `-c`
option, retaining fail-closed verification. A Linux regression shim rejects GNU-only options
even on Actions' GNU host. A new Actions image and real first-install retest are still required;
the earlier API acceptance alone does not establish a working installation.

Revision `5dfc917a` passed the portable installer tests in both Actions validation runs, but
the standalone CI again failed one native Mihomo chain case (30/31 passed). The separate image
validation passed 31/31. A listening SOCKS port is not application readiness: upstream
[ApplyConfig](https://github.com/MetaCubeX/mihomo/blob/v1.19.30/hub/executor/executor.go)
opens listeners before `tunnel.OnRunning()`, and
[handleTCPConn](https://github.com/MetaCubeX/mihomo/blob/v1.19.30/tunnel/tunnel.go)
closes non-inner connections until that state is reached. The failed case logged initialization
but no routed TCP connection, consistent with that window; the earlier half-close fix alone
did not eliminate startup races.

The topology harness now reuses the Node repository's separately tested application-readiness
fixture. A nonce challenge has its own loopback-only DIRECT rule and never warms the tested
chain. All eight topology requests still execute once, and exact per-hop connection counts
remain mandatory. Unit tests reject an open-but-not-ready SOCKS frontend, a wrong challenge,
and an exited client; readiness has a bounded deadline. Native Actions/VPS verification of
this harness correction remains required.

Revision `a5100ba5` passed the full
[CI run](https://github.com/FengYuchen1314/backend/actions/runs/33944994091), including the
31 native cases and ten cases in the compiled portable bundle. Image validation also passed,
and packaging verified all six archives. The Docker build then caught a build-context omission:
it copied test sources but not the new shared readiness fixture they import. The fixture and
its declaration are now copied into the builder stage only, not the final runtime. No image
from that failed build was deployed, and VPS installation acceptance remains pending.

## Accepted Actions image and real first install

Backend `d17f4f2e0bc9e44a5bfea8b36a6469c5bd693681`, paired with frontend
`db3fc697571735f5dc38ac1044d9c96ad676566c`, passed both the full
[CI](https://github.com/FengYuchen1314/backend/actions/runs/33945412935) and the
[multi-platform image workflow](https://github.com/FengYuchen1314/backend/actions/runs/33945413141).
The accepted image is
`ghcr.io/fengyuchen1314/backend@sha256:b6000aeed10f4ae1cd5cd5a5f75bdb3f5552fda69fb74216769fb561ec9bfdc2`.
The VPS verified the exact source pair, runtime channel and all six embedded archive hashes
before replacing only its disposable panel. Both topology records and the manual Mieru
entry `34443` to IX `24443` mapping/shared profile survived unchanged.

The full API downloaded all six archives again and verified byte counts, hashes and no-store
headers. Replayed bootstrap tokens, invalid artifact grants, cross-role access and traversal
were rejected. The newly API-generated public-direct installer then ran unmodified in the
private Alpine/Docker engine with an empty image store and no registry egress. HTTPS used the
explicit private trust anchor, not `--insecure`. BusyBox checksums, all three real image imports,
identity checks and Compose startup succeeded. Node, HAProxy and Caddy were running with zero
restarts; both edge services were healthy. The actual port-80 HAProxy route reached Caddy's
unconfigured 404 seed, and installation directory/config permissions were `700`/`600`.

An independent read-only health check used the disposable panel's real CA, client certificate
and signing key, pinning the exact Node certificate issued in the installer. The Node health
API answered successfully, as did the Agent's HAProxy master-socket and Caddy-admin checks.
Missing mTLS, missing JWT and invalid JWT were rejected; a subsequent authorized health request
still passed. No proxy profile was applied, so this is not evidence of shared-443 protocol
traffic, working public website TLS/ACME or connected proxy users.

Re-running the installer failed before modification. Hashes of all four generated configuration
files and the exact container IDs remained unchanged. Private acceptance files are under
`/opt/xboard-panel-test.oKbMNrzT/bootstrap-d17f4f2e`; installer files contain credentials and must
not be published or displayed.

Separately, the Actions-compiled `a5100ba5` topology bundle passed 61/61 tests with no skips on
the VPS: twenty fresh client processes per scenario, eight non-retried traffic requests each,
and the half-close regression. Every chain's per-hop counts matched. Bundle SHA-256:
`d0daae1d3296f782922b19002016e287a1005c17139929068eb4b45978189747`.
The isolated test container was removed; the verified bundle remains in
`/opt/xboard-topology-test.qKGNP4i5`. This establishes container-loopback native-client behavior,
not cross-physical-server traffic or all protocol combinations.

After acceptance, the temporary privileged engine, TLS relay and engine's dedicated image-store
volume (including the three disposable services) were removed. No host Docker socket, host
network or existing service was involved. The test panel was restarted using its original saved
environment, removing the temporary loopback-TLS origin override; both topology records and
the Mieru mapping/profile were again verified unchanged. Private evidence and prior images were
retained. Both PDF containers remained healthy, and the PDF endpoint returned HTTP 200.
