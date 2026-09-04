# Published subscription topologies

This feature reuses the existing topology records, graph compiler, Host resolver and native
subscription generators. No new graph database table or alternative subscription endpoint is used.

## Publication

New and legacy records default to `isPublished: false`. Saving a draft does not publish it.
Administrators publish or unpublish with the existing version-checked update endpoint:

```http
PATCH /api/topologies/:uuid
Content-Type: application/json

{"expectedVersion": 1, "isPublished": true}
```

The returned version must be used for the next mutation. Publishing, saving, unpublishing and
deleting all use the same atomic revision check. A concurrent writer receives a conflict rather
than silently overwriting a newer graph. Editing a published record preserves its published state;
unpublish first when further edits should remain drafts. Client subscription refresh applies changes.

The UI disables publication for unsaved/conflicting drafts and explains the refresh behavior.
Deleting a published topology removes its virtual node at the next subscription refresh, not from
already downloaded client configurations.

## Binding and access

- Only active users with access to **every** constituent Host receive the composite. Its credentials
  come from the existing user-specific Host resolver; missing members are never looked up separately.
- Each published Host must have exactly one physical Node association, with its inbound active on
  that enabled Node. A shared multi-server Host address cannot pin a canvas server selection, so
  ambiguous bindings are rejected for publication and omitted on subsequent subscription refresh.
- The configured Host endpoint is preserved, including a Mieru domestic entry/NAT address. It is
  not replaced with the Agent's management address. Administrators must configure accurate endpoints.
- Existing graph cycle, same-Node revisit, connectivity and depth checks remain mandatory. Changes
  to referenced Hosts/Nodes are rechecked on subscription refresh.
- A missing, disabled, inaccessible or client-excluded member omits the **whole** composite. Ordinary
  subscription nodes remain unchanged. A malformed/unavailable optional topology store omits all
  composites without failing the ordinary subscription.

## Native output

| Output                          | Supported graph semantics                                          |
| ------------------------------- | ------------------------------------------------------------------ |
| Mihomo                          | Chains, round robin, consistent hashing, URL test, selector        |
| sing-box                        | Chains, URL test, selector; round robin/consistent hashing omitted |
| Xray JSON, Base64, Clash, Stash | No graph injection yet                                             |

Unsupported protocols/transports also omit the whole graph. No unsupported strategy is converted
silently into a different strategy. This support table describes compilation, not universal protocol
interoperability; real TCP tests currently use authenticated SOCKS5 hops, not every protocol pairing.

Each graph clones its constituent proxies into a private namespace. An independent entry selector
is added to the usual subscription choices, while the intermediate clones are not appended to those
choices. Proxy/provider templates can deliberately opt out of automatic node inclusion as before.
Preview-only binding metadata is removed from final client configurations.

The compiler writes a hop's predecessor into `dialer-proxy` (Mihomo) or `detour` (sing-box), because
these describe the transport used to **reach** that hop. The entry selector selects the final hop.
Many incoming branches feed their explicit group; a downstream hop connects through that group.

Round-robin and hashing groups emit the configured health-check URL and interval, as URL-test
groups do. The probe target must be reachable through the member routes. When all members fail a
probe, Mihomo can fall back to its first member; that is not evidence that balancing is working.

## Verification and portable VPS runner

`npm run test:topology` covers permission filtering, stale/ambiguous references, publication,
version conflicts, normal subscription entry points, complete graph omission and private naming.
`npm run test:topology-db` checks legacy defaulting and eight concurrent updates against PostgreSQL
when the dedicated `EDGE_DATABASE_TEST_URL` test database is configured.

`scripts/test-topology-clients.sh` obtains official Mihomo 1.19.30 and sing-box 1.14.0 binaries and
checks their pinned release-asset SHA-256 digests. Three scenarios are each repeated three times:
Mihomo two-hop chaining, Mihomo two entrances into one exit with round robin, and sing-box two-hop
chaining. Each scenario makes eight real HTTP requests through separately authenticated listeners.
Health probes use a separate local destination so probe traffic cannot count as balanced data traffic.

GitHub Actions also compiles the acceptance entry using the project's Rspack configuration and
exports it with the verified clients, source commit and archive checksum. After verifying the
downloaded archive checksum, extract into a new private `/opt/xboard-topology-test.*` directory and
run its `vps-topology-smoke.sh` with that exact directory. The script uses a digest-pinned existing
backend image only as the Node/dependency runtime; the tested generators/compiler come from the
new Actions bundle. It does not launch the panel or access its database.

The VPS runner has no network beyond its container loopback, no host-published ports, no Docker
socket, a read-only filesystem/mount and bounded CPU/memory/PID limits. Temporary fixtures are
removed; the disposable container is removed even on failure. It does not alter the VPS's existing
proxy or PDF services. The private downloaded acceptance bundle is retained for diagnosis.

These loopback fixtures simulate independent servers; they do not constitute full panel/browser
acceptance or a test of every protocol across multiple physical VPS hosts.
