# Shared-443 reverse-proxy settings (WIP)

The node editor has a separate **Shared 443 · Website reverse proxy** section for public-direct
servers. This is not yet a production release. It requires an edge-capable Agent, the new panel
API and the `node_edge_config` database migration. Leased-line and broadband servers do not use
this section.

Each server has two optional sites: `management` for a panel and `website` for another HTTP
service. Each site accepts up to 32 exact DNS names and one HTTP/HTTPS upstream origin. Paths,
queries, embedded credentials and fragments are rejected. Domains cannot overlap each other
or a managed proxy's SNI. Public edge/self-loop targets are rejected by the panel and checked
again against local interfaces and DNS on the Agent. HTTPS upstream certificate checks remain
enabled.

Point the website DNS records at the server before applying. Caddy obtains website certificates;
the Agent control port and Caddy admin port must remain private. HAProxy handles public 80/443,
with exact TLS SNI routes for managed VLESS REALITY and a website fallback. Caddy listens on
loopback 18080/18443. HTTP requests to configured website names redirect to HTTPS with status 308.
This does not establish mainland reachability for proxy camouflage domains.

## Saving and applying

- `GET /api/nodes/:uuid/edge-settings`: saved settings, revision and best-effort Agent capability.
- `PUT /api/nodes/:uuid/edge-settings`: administrator-only desired-state update with
  `expectedRevision` and `settings`. Revision 0 creates the first record; stale revisions return
  HTTP 409. The UI keeps the conflicting draft until the administrator chooses to reload.
- Saving does **not** confirm runtime activation. **Apply saved settings** sends the existing
  node restart request with `forceRestart: true`; this can interrupt proxy connections. A queue
  acknowledgement is not success evidence. Check node status/errors after applying.
- An active configuration profile is required to use that restart path. The Agent must report
  edge availability. Configuration changes also take effect on later normal node starts.

Panel-owned settings use a small table related to the existing physical Nodes record. This
prevents Agent metadata reports from overwriting them. Old `metadata.xboardEdge` values are read
only as a compatibility fallback before the first saved revision. Deleting a Node cascades its
edge settings; deleting an individual proxy inbound does not erase website settings.

The Agent serializes core/edge changes, journals previous edge configuration, waits for HAProxy's
synchronous reload acknowledgement, and attempts to restore both the core and edge after a
failure. An unconfirmed rollback retains the journal and reports failure rather than success.
Caddy's server-side request Origin checks are retained; the Agent supplies its local Origin.

## Validation boundary

CI tests use real HAProxy/Caddy containers for two SNI routes, PROXY-v2, bad-config rejection,
journal recovery, HTTPS website proxying, 308 redirects and private Caddy listeners. Certificate
issuance in that test uses an ephemeral internal CA, not public ACME. PostgreSQL tests exercise
migrations, concurrent initial inserts/updates, stale revisions, metadata replacement and
foreign-key cleanup.

Full panel-to-Agent acceptance and browser regression tests are still required. AnyTLS/ShadowTLS
routing is not implemented by this WIP; it must not be advertised as supported by these tests.
