# Paired backend and frontend builds

The backend image workflow builds a single, pinned frontend checkout against the contract in
the backend checkout being released. It no longer waits for, or guesses compatibility from,
an independently published frontend release asset. Tests and the production frontend build
must succeed before the Docker build starts. The image records both commit identifiers.

Pushing `xboard-dev` publishes the development tag and a tag containing both commit hashes.
Pushing `wip/**` validates/builds the image without publishing or changing the development tag.
After frontend-only changes, run the backend workflow explicitly:

```sh
gh workflow run xboard-image.yml --repo FengYuchen1314/backend --ref xboard-dev -f frontend_commit=FULL_FRONTEND_COMMIT_SHA
```

The optional frontend cross-repository dispatch token can automate that same request. Without
it, the frontend workflow explicitly reports that its artifact is not a released backend image.
No personal access token is embedded in source or required for backend-triggered builds.

The Dockerfile retains the upstream download path as its default. The paired workflow selects
`FRONTEND_SOURCE=local` and supplies `.xboard-frontend` produced by the preceding validated build.
Do not use an arbitrary local frontend directory for a release.
