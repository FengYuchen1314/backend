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

Actions image packaging, authenticated full-panel downloads and an isolated VPS first install
still require acceptance. These shell fixtures do not establish real Node health, shared-443
traffic, Mieru traffic, AnyTLS integration or the panel update workflow.

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
