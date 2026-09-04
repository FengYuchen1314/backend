# Topology backend contract

Topologies are stored without a database migration. Each topology is a row in the existing
`subscription_templates` table with `template_type = XBOARD_TOPOLOGY`. Its `template_json` is a
versioned internal envelope:

```json
{
  "kind": "XBOARD_TOPOLOGY",
  "schemaVersion": 1,
  "version": 1,
  "graph": {}
}
```

The ordinary subscription-template repository explicitly excludes this internal type, including
list, lookup, tags, reorder, and Xray host-template resolution. Existing subscription generation
therefore remains unchanged.

## Graph direction

Edges follow traffic direction. An entry may start one direct branch or multiple branches. A proxy
has exactly one previous and next hop. Multiple entry branches are load-balanced by dragging their last proxies
into the same `LOAD_BALANCER`; the group then has exactly one next hop. Every node must be on a path
from the single entry to the single exit.

Client dialer dependencies run against the drawn traffic direction: for `Entry -> A -> B -> Exit`,
the selectable entry points to B and B uses A as its dialer. For `(A, B) -> Group -> C`, C uses Group,
and Group contains the terminal proxies of the two incoming branches. Branches must merge through
an explicit load balancer, not directly into a proxy or the exit.

The backend rejects missing references, duplicate ids or edges, self-edges, directed cycles,
disconnected nodes, host/physical-node ownership mismatches, inactive inbounds, duplicate proxy
pairs, repeated physical servers on one path, ambiguous branching, empty groups, and graphs deeper
than 16 edges. API input is limited to 64 nodes and 128 edges.

Updates and deletes require `expectedVersion`. The SQL write checks the JSON envelope version in the
same statement, so concurrent writes cannot silently overwrite one another.

## Preview artifacts

Mihomo preview returns an injection object with exact `(hostUuid, nodeUuid)` proxy bindings,
`dialer-proxy` patches, and native `proxy-groups`. sing-box returns equivalent bindings, `detour`
patches, and selector/urltest outbounds. A subscription merger must bind every required pair and
fail closed if a referenced proxy is unavailable; it must never select a proxy by display name.

sing-box round-robin and consistent-hash groups return structured `UNSUPPORTED`, because sing-box
does not provide equivalent semantics. Xray JSON also returns structured `UNSUPPORTED` until its
generator has a safe graph binding. Base64 URI subscriptions always return structured
`UNSUPPORTED`; they cannot encode chains or balancing without losing semantics.

Persistence, validation, and deterministic preview compilation do not automatically activate a
topology for ordinary subscriptions. Activation needs an explicit user/squad/template binding so a
saved graph cannot unexpectedly alter every existing subscription.
