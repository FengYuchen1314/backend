# Paired WIP image acceptance

The backend image workflow can publish WIP builds without changing `xboard-dev`. Every image
has a `backend-<40-character SHA>-frontend-<40-character SHA>` tag; only a build of the actual
`xboard-dev` branch receives the mutable deployment tag. The image metadata records its real
branch instead of incorrectly labeling a WIP build as `xboard-dev`.

Source metadata and runtime channel are distinct. `__RW_METADATA_GIT_BRANCH` records the real
Git branch; the Docker `BRANCH` build argument sets `REMNAWAVE_BRANCH` and must remain the
upstream-supported channel `dev` for these fork builds. `NODE_ENV` remains production. Neither
`wip/...` nor `xboard-dev` is an accepted runtime channel in the production config schema.

For acceptance of a specific frontend change, dispatch `xboard-image.yml` on the backend WIP
branch and supply the exact `frontend_commit`. The workflow installs the contract packed from
that backend checkout into the requested frontend, runs frontend tests and builds its static
assets in GitHub Actions. Ordinary push builds retain the existing default frontend selection;
never confuse those builds with an explicitly paired acceptance run.

Use the digest reported by the successful Actions build for VPS tests, not a mutable tag.
Publishing an image is not deployment or browser acceptance. Database migrations and disposable
panel/API/browser tests must still run before claiming the paired application works. Existing
PDF and proxy services on the shared test VPS must be preserved.

The desired frontend for the next explicit WIP acceptance build is
`d6bc1fa1c442572de287d6812241a1218059140e` (`wip/shared-443-ui`). AnyTLS managed creation remains
disabled and is not made functional by this pipeline change.

## First complete-image finding

The first paired image from backend `93f0816737cd0fb92e11f5677b03fb19b987dc5e` and frontend
`5df763b7e151d8a9247f2bed3d862621fc360016` built successfully in
[Actions 33933545827](https://github.com/FengYuchen1314/backend/actions/runs/33933545827), digest
`sha256:ec705247bb7991800262af0790067f4624014feb007d134ebd7fcdbdeb81db49`.
Its private VPS fixture `/opt/xboard-panel-test.yDiYZuIk` completed database migration/seeding
but failed application bootstrap: the image's `REMNAWAVE_BRANCH=wip/shared-443-backend` was
rejected by the production schema. This is a failed image acceptance, not a working panel.

The workflow now keeps the runtime channel separate. A regression test reads the emitted
build argument and checks it against the actual production config schema; it failed before
the correction. Rebuilding and repeating fresh-database API/browser acceptance is required.

## Corrected image and API findings

Backend `9ce0671f2ff3d1812554745b169d3389d3203e7f`, paired with frontend
`5df763b7e151d8a9247f2bed3d862621fc360016`, passed
[CI 33934548252](https://github.com/FengYuchen1314/backend/actions/runs/33934548252) and
[image build 33934548473](https://github.com/FengYuchen1314/backend/actions/runs/33934548473).
The published and VPS-pulled digest is
`sha256:44e5a1bdd2ccd83708eb75be751da7cc101d0fa5b638b0d05d2775b0ae0c400b`.

On 2026-09-05, `/opt/xboard-panel-test.oKbMNrzT` on the test VPS booted this unmodified image,
with no runtime-channel override, against a fresh private PostgreSQL/Valkey fixture. Production
migrations/seeding, served HTML and its actual module asset, disposable admin registration,
unauthorized denial and authenticated nodes/profiles/topologies/camouflage-catalog reads passed.
Admin-JWT requests include the same client-type header as the browser; absence is separately
verified as forbidden. Every catalog seed remains ineligible for automatic selection without
the required live evidence. The private test relay is reached over SSH, not public TLS/ACME.

Further API checks passed managed server-type rejection before persistence, public Vision and
broadband SOCKS creation, reverse-proxy desired-setting persistence and stale revision rejection,
and topology reference/layout persistence, stale-version rejection and self-loop rejection.
These are offline metadata fixtures, not real Agent deployment or client-traffic acceptance.

One integration finding remains in that image: reverse-proxy input rejected by the service uses
the upstream generic config error `A061`, whose HTTP status is 500. Wrong server type and
upstream loops must be client errors. The correction introduces the edge-specific `XE002`/400
without changing the upstream generic error globally. A regression exercises the actual service
and controller error handler, failed before the correction, and confirms no persistence occurs.
Backend `3bdbee41463cafc10396e53c37cde7aed6fe6680` passed this error regression in the VPS
image paired with frontend `c639ce75b8152fb30f784738ed7fbcf62c6f6c6c`, digest
`sha256:9ff79bc5c47f0546e2d90242653a1ca07ca2327c3ae0333008741e95308e3544`.
Both rejected requests returned 400/XE002 and left saved settings and revisions unchanged.

## Restart data-loss finding — do not deploy the earlier images

The next pair, backend `3bdbee41463cafc10396e53c37cde7aed6fe6680` and frontend
`d6bc1fa1c442572de287d6812241a1218059140e`, built in
[Actions 33936591273](https://github.com/FengYuchen1314/backend/actions/runs/33936591273), digest
`sha256:2e0c90900cba2ab4b610f554bd70d830da891f9ce1997a435b6a8b448c54c870`.
A fresh private VPS fixture `/opt/xboard-panel-test.dLSYqnfI` passed bootstrap, auth/asset reads,
managed server policy, edge persistence/conflict and topology save/version/reference tests.

However, browser restore in the upgraded `/opt/xboard-panel-test.oKbMNrzT` fixture found the
previously API-verified graphs absent, while nodes and edge settings remained intact. The startup
subscription-template seeder deletes types outside the public-format list. Graph storage uses
`XBOARD_TOPOLOGY` in that same table and was accidentally included in this cleanup. Passing
create/read tests without a real application restart did not cover this data-loss path.

The correction preserves the existing internal type in the seeder's cleanup allowlist, without
adding it to public formats or creating a default graph. An actual-seeder unit regression failed
before the correction. PostgreSQL coverage calls the seeder twice with draft and published graphs,
checking complete row equality, publication state, versions and timestamps inside a rolled-back
test transaction. Both CI and image publication now run the seed regression. A corrected Actions
image still must pass restart/upgrade preservation on the VPS before acceptance is complete.
Only disposable acceptance records were affected; this is not evidence of damage to production data.

## Mixed-runtime bootstrap regression

The startup audit also found `syncInbounds` unconditionally instantiating `XRayConfig`, unlike the
existing create/edit services. A valid stored Mieru profile has `listeners`, not Xray `inbounds`,
so startup throws `Config doesn't have inbounds.` before the panel starts. An actual-seeder unit
test with both Mieru and SOCKS profiles reproduced this failure. Startup now chooses the existing
Mieru parser for Mieru profiles and retains the original Xray path for other profiles. No new
runtime or alternate storage is introduced. The regression repeats synchronization without any
inbound replacement; PostgreSQL coverage additionally checks the inbound, node, Host and binding
rows inside a rolled-back transaction.

The paired frontend separately corrects the generated Mieru listener default from forbidden port
443 to 24443; both the existing browser validator and backend contract require ports 1025–65535.
The preset regression now checks that range. These source fixes still require the new Actions
pair and actual VPS cold-start acceptance; the earlier 22e2/d6bc image run was deliberately cancelled.
