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
