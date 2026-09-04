# Xboard updater sidecar contract

The panel does not update its host directly. It never executes shell commands and must not be
given access to a container runtime socket. One-click update is available only when a separately
operated updater service is configured with both `UPDATER_URL` and `UPDATER_SECRET`.

The updater implementation lives in `updater/` and is deployed with
`docker-compose-xboard.yml`. It is the only component that may be granted the deployment
permissions needed for the installation it manages. Keep it on the private control network, do
not publish its port, and do not mount its privileged resources into the panel.

## Panel configuration

| Variable             | Meaning                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| `UPDATER_URL`        | Private base URL of the updater. Only `http` and `https` are accepted. |
| `UPDATER_SECRET`     | Shared secret, 32–512 printable ASCII characters without spaces.       |
| `UPDATER_TIMEOUT_MS` | Per-request timeout, 1,000–30,000 ms; defaults to 8,000 ms.            |

If the URL and secret are absent, `GET /api/system/updates/status` reports `UNCONFIGURED` and the
frontend keeps the update action disabled. Configuring only one of them is a startup validation
error.

Every request from the panel uses these fixed properties:

- Header: `X-Xboard-Updater-Secret: <UPDATER_SECRET>`
- Channel: `xboard-dev`
- Redirects: disabled, so the secret is never forwarded to another origin
- Maximum response size: 64 KiB

The updater should compare the secret in constant time and must reject all other channels.

## `GET {UPDATER_URL}/v1/status?channel=xboard-dev`

On success, return HTTP `200` and exactly this JSON shape:

```json
{
  "channel": "xboard-dev",
  "state": "IDLE",
  "currentVersion": "3.4.3-xboard.12",
  "targetVersion": "3.4.3-xboard.13",
  "updateAvailable": true,
  "lastError": null,
  "updatedAt": "2026-09-04T12:00:00.000Z"
}
```

Field rules:

- `state`: one of `IDLE`, `UPDATING`, `SUCCEEDED`, `FAILED`.
- `currentVersion` and `targetVersion`: string or `null`, at most 100 characters.
- `updateAvailable`: boolean.
- `lastError`: string or `null`, at most 2,000 characters.
- `updatedAt`: ISO-8601 UTC timestamp or `null`.

An invalid payload is shown as an updater failure. A network failure is shown as `UNREACHABLE`.
The panel does not infer a successful health check from its own process state.

## `POST {UPDATER_URL}/v1/update`

Request body:

```json
{
  "channel": "xboard-dev"
}
```

For a newly accepted request, return HTTP `202` (HTTP `200` is also accepted):

```json
{
  "accepted": true,
  "operationId": "01J7ABCDEF1234567890",
  "state": "QUEUED",
  "message": null
}
```

If an update is already running, return HTTP `409` with the same shape:

```json
{
  "accepted": false,
  "operationId": "01J7ABCDEF1234567890",
  "state": "UPDATING",
  "message": "An update is already in progress"
}
```

`state` must be one of `QUEUED`, `UPDATING`, `REJECTED`. `operationId` is a non-empty string of at
most 128 characters or `null`; `message` is at most 2,000 characters or `null`. Other non-2xx
responses are mapped to `REJECTED`, and transport failures are mapped to `UNREACHABLE`.

The updater serializes update operations and makes repeated requests safe. See the safety model
below for the artifact, deployment, health validation, and recovery boundaries.

## Supported deployment

Version 1 intentionally supports only the standard `docker-compose-prod.yml` layout and only the
`remnawave` service. The advanced multi-process Compose layout is rejected rather than updated
partially. The backend image already contains the frontend, so one backend image update updates
both parts of the panel.

Install the repository files under one absolute directory (the default is `/opt/remnawave`), set a
random `UPDATER_SECRET` of at least 32 characters in `.env`, and start the base and Xboard override
together:

```sh
docker compose \
  --project-directory /opt/remnawave \
  --project-name remnawave \
  --file /opt/remnawave/docker-compose-prod.yml \
  --file /opt/remnawave/docker-compose-xboard.yml \
  up --detach
```

When an update reaches deployment, the updater creates or updates
`/opt/remnawave/.xboard/active-compose.yml` for either the healthy target or a verified rollback.
It pins the running backend to an immutable digest. Whenever this file exists, include it in every
later operator-initiated Compose command:

```sh
docker compose \
  --project-directory /opt/remnawave \
  --project-name remnawave \
  --file /opt/remnawave/docker-compose-prod.yml \
  --file /opt/remnawave/docker-compose-xboard.yml \
  --file /opt/remnawave/.xboard/active-compose.yml \
  up --detach
```

Do not deploy `active-compose.yml` to another host. It is local updater state.

## Safety model

- The channel, registry repository, Compose project, service, and container name are fixed in the
  binary. Request fields never become executable names, command arguments, paths, or image names.
- The updater resolves `ghcr.io/fengyuchen1314/backend:xboard-dev` through the GHCR API, validates
  a `sha256` digest, and performs every pull and deployment using the resulting immutable
  `repository@digest` reference. A tag move after resolution cannot change that operation.
- Both the running and target images must declare
  `io.xboard.updater.protocol=1` and the exact fork source label. The first updater-compatible
  image is therefore a manual baseline; the updater will not take over an older or unrelated
  container.
- Version 1 only automates database-bootstrap-compatible releases. It verifies that the current
  database has no pending Prisma migration and compares a bounded, canonical fingerprint of
  `prisma/schema.prisma`, `prisma/migrations`, the compiled `dist/seed.js`, and the container
  entrypoint between the running and target images. A schema, migration, data-migration, or
  bootstrap change is rejected and requires a manual, backed-up upgrade.
- Automated update and rollback containers set `XBOARD_SKIP_DB_BOOTSTRAP=1`. This skips both
  `prisma migrate deploy` and `prisma db seed`; the updater never claims to reverse a database
  migration. Normal manual starts keep the upstream migration and seeding behavior.
- The previous local image is tagged before replacement. The target must have Docker health state
  `healthy`, serve the metrics/database health endpoint, and serve the panel HTTP endpoint twice
  across a stability interval. A failure recreates the service from the preserved image and
  verifies it before recording a rolled-back failure.
- An OS file lock and an in-process lock serialize operations. A mode-0600 journal and Compose
  override are written using a temporary file, `fsync`, and rename. On restart, an interrupted
  operation is reconciled against the actual running image and either committed or rolled back.

The current workflow does not sign images. The fixed GHCR repository and immutable digest prevent
tag substitution during one operation, but they do not protect against compromise of the GitHub
repository, Actions workflow, or package publisher. Keyless signing and verification should be
added before treating the updater as a high-assurance supply-chain boundary.

## Docker socket warning

Only `xboard-updater` mounts the Docker socket. The panel container never does. The updater also
uses a read-only root filesystem, drops Linux capabilities, has no published port, and shares an
internal control network only with the panel.

Access to a rootful Docker socket is nevertheless effectively host-root access. Running the
sidecar as a non-root container or placing a generic socket proxy in front of Compose does not
remove that authority. Prefer running the deployment with rootless Docker. With rootful Docker,
the small updater process must be treated as a privileged trusted computing base; never add host
PID/network mode, `privileged: true`, or a host-root bind mount.
