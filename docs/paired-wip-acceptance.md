# Paired WIP image acceptance

The backend image workflow can publish WIP builds without changing `xboard-dev`. Every image
has a `backend-<40-character SHA>-frontend-<40-character SHA>` tag; only a build of the actual
`xboard-dev` branch receives the mutable deployment tag. The image metadata records its real
branch instead of incorrectly labeling a WIP build as `xboard-dev`.

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
