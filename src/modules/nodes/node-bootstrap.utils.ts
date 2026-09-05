import { createHash } from 'node:crypto';

import { SERVER_TYPES, SERVER_TYPES_VALUES, TServerType } from '@libs/contracts/constants';

import { BootstrapDownloads, renderArtifactDownloads } from './node-bootstrap-download';

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

    const command = `set -Eeuo pipefail; umask 077; script=$(mktemp); trap 'rm -f -- "$script"' EXIT; curl --fail --silent --show-error${protocolRestriction} --connect-timeout 15 --max-time 60 --request POST --header 'Content-Type: application/json' --data-raw ${shellSingleQuote(body)} ${shellSingleQuote(redeemUrl)} --output "$script"; bash "$script"`;
    return `bash -c ${shellSingleQuote(command)}`;
}

export function renderNodeBootstrapInstaller(
    nodePort: number,
    secretKey: string,
    serverType: TServerType,
    downloads: BootstrapDownloads,
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
    const artifactDownloads = renderArtifactDownloads(serverType, {
        ...downloads,
        panelOrigin: normalizePanelOrigin(downloads.panelOrigin, undefined, undefined),
    });

    const usesMita = serverType === SERVER_TYPES.LEASED_LINE;
    const usesEdge = serverType === SERVER_TYPES.PUBLIC_DIRECT;
    const mitaEnvironment = usesMita
        ? '\nMIERU_ENABLED=true\nMIERU_METRICS_BASELINE_PATH=/var/lib/remnanode/mieru-metrics-baselines.json\nMIERU_STATE_DIR=/var/lib/remnanode/mieru\nMIERU_SOCKET_DIR=/var/run/rw-mita'
        : '';
    const edgeEnvironment = usesEdge
        ? '\nEDGE_ENABLED=true\nEDGE_CONFIG_DIR=/var/lib/remnanode/edge\nEDGE_HAPROXY_MASTER_SOCKET=/var/run/xboard-edge/haproxy-master.sock\nEDGE_CADDY_ADMIN_URL=http://127.0.0.1:2019'
        : '';
    const remnanodeMitaConfig = usesMita
        ? `
    volumes:
      - remnanode-state:/var/lib/remnanode`
        : '';
    const remnanodeEdgeConfig = usesEdge
        ? `
    volumes:
      - ./edge:/var/lib/remnanode/edge
      - edge-run:/var/run/xboard-edge
    depends_on:
      haproxy:
        condition: service_healthy
      caddy:
        condition: service_healthy`
        : '';
    const edgeServices = usesEdge
        ? `
  haproxy:
    image: \${XBOARD_HAPROXY_IMAGE:?Missing verified image}
    pull_policy: never
    user: "0:0"
    container_name: xboard-edge-haproxy
    hostname: xboard-edge-haproxy
    network_mode: host
    restart: always
    command:
      - haproxy
      - -W
      - -db
      - -f
      - /usr/local/etc/haproxy/haproxy.cfg
      - -S
      - /var/run/xboard-edge/haproxy-master.sock
    volumes:
      - ./edge:/usr/local/etc/haproxy:ro
      - edge-run:/var/run/xboard-edge
    healthcheck:
      test: ["CMD", "haproxy", "-c", "-f", "/usr/local/etc/haproxy/haproxy.cfg"]
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 5s

  caddy:
    image: \${XBOARD_CADDY_IMAGE:?Missing verified image}
    pull_policy: never
    container_name: xboard-edge-caddy
    hostname: xboard-edge-caddy
    network_mode: host
    restart: always
    command: ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile", "--resume"]
    volumes:
      - ./edge/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    healthcheck:
      test: ["CMD", "caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 5s
`
        : '';
    const mitaVolumes = usesMita
        ? `

volumes:
  remnanode-state:`
        : '';
    const edgeVolumes = usesEdge
        ? `

volumes:
  edge-run:
  caddy-data:
  caddy-config:`
        : '';
    const edgeSeed = usesEdge
        ? `
install -d -m 700 "\${INSTALL_DIR}/edge"

cat >"\${INSTALL_DIR}/edge/haproxy.cfg" <<'XBOARD_EDGE_HAPROXY'
global
    log stdout format raw local0
    master-worker
    user haproxy
    group haproxy

defaults
    log global
    mode tcp
    timeout connect 5s
    timeout client 1m
    timeout server 1m

frontend xboard_http
    bind :80
    default_backend xboard_caddy_http

frontend xboard_https
    bind :443
    tcp-request inspect-delay 5s
    tcp-request content accept if { req.ssl_hello_type 1 }
    default_backend xboard_caddy_https

backend xboard_caddy_http
    server caddy_http 127.0.0.1:18080 check

backend xboard_caddy_https
    server caddy_https 127.0.0.1:18443 check
XBOARD_EDGE_HAPROXY

cat >"\${INSTALL_DIR}/edge/Caddyfile" <<'XBOARD_EDGE_CADDY'
{
    admin 127.0.0.1:2019
    auto_https off
}

http://127.0.0.1:18080 {
    bind 127.0.0.1
    respond "Xboard edge is not configured" 404
}

http://127.0.0.1:18443 {
    bind 127.0.0.1
    respond "Xboard edge is not configured" 404
}
XBOARD_EDGE_CADDY

chmod 600 "\${INSTALL_DIR}/edge/haproxy.cfg" "\${INSTALL_DIR}/edge/Caddyfile"
`
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
if [[ -e "\${INSTALL_DIR}/.env" || -e "\${INSTALL_DIR}/compose.yml" || -e "\${INSTALL_DIR}/edge" ]]; then
  echo "Refusing to overwrite an existing Node installation." >&2
  exit 1
fi
for container in remnanode${usesEdge ? ' xboard-edge-haproxy xboard-edge-caddy' : ''}; do
  if docker container inspect "$container" >/dev/null 2>&1; then
    echo "Existing container $container must be managed separately; refusing to replace it." >&2
    exit 1
  fi
done
${artifactDownloads}
install -d -m 700 "\${INSTALL_DIR}"
${edgeSeed}

cat >"\${INSTALL_DIR}/.env" <<'REMNAWAVE_NODE_ENV'
NODE_PORT=${nodePort}
SECRET_KEY=${secretKey}${mitaEnvironment}${edgeEnvironment}
REMNAWAVE_NODE_ENV
printf 'XBOARD_NODE_IMAGE=%s\\n' "$XBOARD_NODE_IMAGE" >>"\${INSTALL_DIR}/.env"
${usesEdge ? `printf 'XBOARD_HAPROXY_IMAGE=%s\\nXBOARD_CADDY_IMAGE=%s\\n' "$XBOARD_HAPROXY_IMAGE" "$XBOARD_CADDY_IMAGE" >>"\${INSTALL_DIR}/.env"` : ''}

cat >"\${INSTALL_DIR}/compose.yml" <<'REMNAWAVE_NODE_COMPOSE'
services:
  remnanode:
    image: \${XBOARD_NODE_IMAGE:?Missing verified image}
    pull_policy: never
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
      - .env${remnanodeMitaConfig}${remnanodeEdgeConfig}${edgeServices}${mitaVolumes}${edgeVolumes}
REMNAWAVE_NODE_COMPOSE

chmod 600 "\${INSTALL_DIR}/.env" "\${INSTALL_DIR}/compose.yml"
cd "\${INSTALL_DIR}"
docker compose --file compose.yml up --detach --pull never --no-build

echo "Remnawave Node was installed successfully."
`;
}
