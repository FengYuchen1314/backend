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
`5df763b7e151d8a9247f2bed3d862621fc360016` (`wip/shared-443-ui`). AnyTLS managed creation remains
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
The corrected error mapping still needs Actions/VPS image revalidation; the earlier image is
not a full feature-acceptance pass. Browser acceptance is recorded separately when performed.
