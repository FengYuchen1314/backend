# Xboard updater sidecar contract

The panel does not update its host directly. It never executes shell commands and must not be
given access to a container runtime socket. One-click update is available only when a separately
operated updater service is configured with both `UPDATER_URL` and `UPDATER_SECRET`.

The updater is not implemented in this repository. It is the only component that may be granted
the deployment permissions needed for the installation it manages. Keep it on a private network,
do not expose it to the internet, and do not mount its privileged resources into the panel.

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

The updater must serialize update operations and make repeated requests safe. Its implementation
must define its own artifact verification, deployment, health validation, and recovery procedure.
This panel contract does not claim or simulate automatic rollback.
