import { createHash } from 'node:crypto';

import { SERVER_TYPES, SERVER_TYPES_VALUES, TServerType } from '@libs/contracts/constants';

export const NODE_BOOTSTRAP_IMAGE = 'ghcr.io/fengyuchen1314/node:xboard-dev';
export const MITA_BOOTSTRAP_IMAGE =
    'ghcr.io/enfein/mita:v3.36.0@sha256:2b31fe24ce7b69ac4250af214ab6f7ec22dd7fff130b8783faf26b1fd4b8b007';
export const NODE_BOOTSTRAP_TTL_SECONDS = 5 * 60;

const SECRET_KEY_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
    const raw = Array.isArray(value) ? value[0] : value;
    return raw?.split(',')[0]?.trim() || undefined;
}

function shellSingleQuote(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function normalizePanelOrigin(
    configuredDomain: string | undefined,
    forwardedProtocol: string | string[] | undefined,
    forwardedHost: string | string[] | undefined,
): string {
    const configured = configuredDomain?.trim();
    const protocol = firstHeaderValue(forwardedProtocol)?.toLowerCase();
    const host = firstHeaderValue(forwardedHost);

    const candidate = configured
        ? configured.includes('://')
            ? configured
            : `https://${configured}`
        : `${protocol === 'http' ? 'http' : 'https'}://${host ?? ''}`;

    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Panel origin must use HTTP or HTTPS.');
    }
    if (!parsed.hostname || parsed.username || parsed.password) {
        throw new Error('Panel origin is invalid.');
    }
    if (
        parsed.protocol === 'http:' &&
        !['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname.toLowerCase())
    ) {
        throw new Error('Panel origin must use HTTPS.');
    }

    return parsed.origin;
}

export function getNodeBootstrapCacheKey(token: string): string {
    const digest = createHash('sha256').update(token).digest('hex');
    return `node_bootstrap:${digest}`;
}

export function buildNodeBootstrapInstallCommand(
    panelOrigin: string,
    token: string,
    redeemPath: string,
): string {
    const redeemUrl = new URL(redeemPath, `${panelOrigin}/`).toString();
    const body = JSON.stringify({ token });
    const protocolRestriction = redeemUrl.startsWith('https://') ? " --proto '=https'" : '';

    return `curl --fail --silent --show-error${protocolRestriction} --request POST --header 'Content-Type: application/json' --data-raw ${shellSingleQuote(body)} ${shellSingleQuote(redeemUrl)} | bash`;
}

export function renderNodeBootstrapInstaller(
    nodePort: number,
    secretKey: string,
    serverType: TServerType = SERVER_TYPES.PUBLIC_DIRECT,
): string {
    if (!Number.isInteger(nodePort) || nodePort < 1 || nodePort > 65_535) {
        throw new Error('Node port is invalid.');
    }
    if (!SECRET_KEY_PATTERN.test(secretKey)) {
        throw new Error('Node secret payload is invalid.');
    }
    if (!SERVER_TYPES_VALUES.includes(serverType)) {
        throw new Error('Server type is invalid.');
    }

    const usesMita = serverType === SERVER_TYPES.LEASED_LINE;
    const mitaEnvironment = usesMita
        ? '\nMIERU_ENABLED=true\nMIERU_METRICS_BASELINE_PATH=/var/lib/remnanode/mieru-metrics-baselines.json\nMITA_UDS_PATH=/var/run/mita/mita.sock'
        : '';
    const mitaService = usesMita
        ? `
  mita:
    image: ${MITA_BOOTSTRAP_IMAGE}
    container_name: mita
    hostname: mita
    network_mode: host
    restart: always
    volumes:
      - mita-config:/etc/mita
      - mita-data:/var/lib/mita
      - mita-run:/var/run/mita
    healthcheck:
      test: ["CMD", "/usr/local/bin/mita", "status"]
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 5s
`
        : '';
    const remnanodeMitaConfig = usesMita
        ? `
    volumes:
      - mita-run:/var/run/mita
      - remnanode-state:/var/lib/remnanode
    depends_on:
      mita:
        condition: service_healthy`
        : '';
    const mitaVolumes = usesMita
        ? `

volumes:
  mita-config:
  mita-data:
  mita-run:
  remnanode-state:`
        : '';

    return `#!/usr/bin/env bash
set -Eeuo pipefail

readonly INSTALL_DIR="\${REMNAWAVE_NODE_INSTALL_DIR:-/opt/remnanode}"

if [[ "\${EUID}" -ne 0 ]]; then
  echo "Run this install command as root." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but was not found." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required but was not found." >&2
  exit 1
fi

umask 077
install -d -m 700 "\${INSTALL_DIR}"

cat >"\${INSTALL_DIR}/.env" <<'REMNAWAVE_NODE_ENV'
NODE_PORT=${nodePort}
SECRET_KEY=${secretKey}${mitaEnvironment}
REMNAWAVE_NODE_ENV

cat >"\${INSTALL_DIR}/compose.yml" <<'REMNAWAVE_NODE_COMPOSE'
services:
  remnanode:
    image: ${NODE_BOOTSTRAP_IMAGE}
    container_name: remnanode
    hostname: remnanode
    network_mode: host
    restart: always
    cap_add:
      - NET_ADMIN
    ulimits:
      nofile:
        soft: 1048576
        hard: 1048576
    env_file:
      - .env${remnanodeMitaConfig}${mitaService}${mitaVolumes}
REMNAWAVE_NODE_COMPOSE

chmod 600 "\${INSTALL_DIR}/.env" "\${INSTALL_DIR}/compose.yml"
cd "\${INSTALL_DIR}"
docker compose --file compose.yml pull
docker compose --file compose.yml up --detach --remove-orphans

echo "Remnawave Node was installed successfully."
`;
}
