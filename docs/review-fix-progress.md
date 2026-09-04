# Review remediation checkpoint

This is a work-in-progress integration, not a deployable release. The objective remains to fix
all review findings and finish the missing connections against the original eight requirements.
Passing unit tests alone is not completion evidence.

## Implemented and locally checked

- Stop Mieru after profile deletion using the persistent leased-line server type, and report
  failed/unconfirmed runtime stops instead of treating them as success. Regression tests added.
- Rewrite numeric-string 443; reject multi-port shared listeners and edge-reserved port
  conflicts; pass the server address from both startup entry points to reject IP self-loops.
- Bind the Caddy seed's internal listeners to loopback.
- Bind topology mutations to the loaded draft revision; preserve conflicts after query refresh.
- Derive Mieru Host fields from watched form values and wait for edit-form initialization.
- Correct topology dialer direction and branch-terminal group membership. Merge topology API
  into the shared-443 integration branch. Subscription activation is NOT implemented yet.
- Build a pinned frontend against the exact backend contract in the image workflow, without
  waiting for independently released assets. WIP builds do not publish the deployment tag.
- Standalone contract builds declare URL's cross-platform types. TopologyModule imports
  CqrsModule for JWT guard dependencies. CI now runs OpenAPI generation to exercise module wiring.

Frontend checkpoint: `07c0a579` (tests/typecheck and GitHub Actions passed).
Backend integrated tests: 67 passed before the pending isolated-Mieru payload changes.
The first paired image builds exposed the missing URL types and module import above; both were
fixed. The latest cloud image run must still be inspected before claiming a successful build.

## In progress: Mieru authorization isolation

The backend working tree now emits `kind: ISOLATED_LISTENERS` with one instance per inbound UUID,
and uses each user's inbound tags rather than a global user union. Two generator tests pass.
Do not publish that payload until the Node controller/runtime accepts and enforces it.

Node checkpoint `9aa4ab0` adds an isolated configuration schema, a thin upstream-Mieru daemon
entrypoint with instance-scoped configuration, Unix socket and metrics dump, and a Linux
integration test using two actual daemons and cross-listener credential attempts. It does not
yet change the existing runtime path. Local Node tests: 39 passed; Linux integration is skipped
on Windows and must be checked in GitHub Actions.

Next connection work:

1. Add an Agent instance supervisor, preserving the existing single-instance helper. Serialize
   reconciliation, start each daemon with a private state directory/socket, persist desired
   state atomically, roll back failed reconciliation, stop removed instances, and stop all
   instances even when the database profile is already gone. Avoid a Docker socket dependency.
2. Accept the isolated envelope on the Mieru start route. Stop any legacy shared sidecar before
   migration; don't silently flatten the new permissions. Retain single-listener compatibility.
3. Keep accounting baselines per instance plus user; aggregate only emitted deltas back to the
   logical user. Preserve final counters for retired instances. Summing raw cumulative counters
   before reset detection is unsafe. The upstream CLI hardcodes a shared metrics dump path;
   this is why the thin daemon uses a private path instead.
4. Update bootstrap volumes/environment for the embedded daemon. Verify real Agent lifecycle,
   credential isolation, user changes, removal, restart, accounting and rollback on Linux/VPS.

## Remaining original requirements and validation

- AnyTLS + ShadowTLS runtime, managed creation and subscription support are missing.
- Agent artifacts/images still come directly from registries; complete panel-sourced delivery.
- Shared 443 still needs the Agent edge API/application path, reverse-proxy management API/UI,
  safe HAProxy/Caddy reload/rollback and real multi-protocol tests.
- Domain catalog still has only three individual discovery seeds per region. Build the requested
  distinct pools and trustworthy mainland evidence integration; never fabricate GFW reachability
  or region evidence. Automatic selection must remain unavailable without adequate evidence.
- Activate selected topologies in actual subscriptions, bind exact host/physical-node pairs,
  preserve client format semantics, and verify chains/load balancing with actual clients.
- Browser regression tests for dirty topology refresh/save and cached Mieru edit initialization.
- Full database/API/client/VPS checks and final successful image publication are still required.
- The authorized test VPS has unrelated PDF translation services: preserve their containers,
  data and secrets. Old proxy/MMW services may be removed only after identifying exact targets
  and retaining a recoverable backup; no server changes have been made at this checkpoint.

The update button, server-type creation restrictions and Mieru entry/IX form exist, but still
need end-to-end acceptance with the completed runtime. Do not mark the goal complete until all
original requirements and review regressions have direct evidence.
