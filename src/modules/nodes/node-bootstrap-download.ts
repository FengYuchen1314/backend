import { SERVER_TYPES, TServerType } from '@libs/contracts/constants';

import { ARTIFACT_ROUTE, ArtifactSchema, BootstrapArtifactPlan } from './node-bootstrap-artifacts';

export interface BootstrapDownloads {
    panelOrigin: string;
    token: string;
    plan: BootstrapArtifactPlan;
}

export function renderArtifactDownloads(
    serverType: TServerType,
    downloads: BootstrapDownloads,
): string {
    if (!/^[A-Za-z0-9_-]{43}$/.test(downloads.token)) throw new Error('Invalid artifact grant');
    const roles =
        serverType === SERVER_TYPES.PUBLIC_DIRECT ? ['node', 'haproxy', 'caddy'] : ['node'];
    const artifacts = downloads.plan.artifacts
        .map((item) => ArtifactSchema.parse(item))
        .filter((item) => roles.includes(item.role));
    if (
        artifacts.length !== roles.length * 2 ||
        new Set(artifacts.map((item) => item.filename)).size !== artifacts.length
    ) {
        throw new Error('Incomplete bootstrap artifact plan');
    }
    const cases = ['amd64', 'arm64']
        .map((arch) => {
            const entries = artifacts.filter((item) => item.arch === arch);
            return `  ${arch})
${entries.map((item) => `    export XBOARD_${item.role.toUpperCase()}_IMAGE='${item.imageTag}'`).join('\n')}
    cat >"\${DOWNLOAD_DIR}/images.tsv" <<'XBOARD_IMAGES'
${entries.map((item) => [item.filename, item.sha256, item.size, item.imageId, item.imageTag].join(' ')).join('\n')}
XBOARD_IMAGES
    ;;`;
        })
        .join('\n');
    return `
for tool in curl sha256sum mktemp; do
  command -v "$tool" >/dev/null || { echo "Required tool missing: $tool" >&2; exit 1; }
done
case "$(docker info --format '{{.OSType}}/{{.Architecture}}')" in
  linux/x86_64|linux/amd64) NODE_ARCH=amd64 ;;
  linux/aarch64|linux/arm64) NODE_ARCH=arm64 ;;
  *) echo "Only Linux amd64 and arm64 Docker engines are supported." >&2; exit 1 ;;
esac
DOWNLOAD_DIR="$(mktemp -d)"
cleanup_downloads() {
  rm -f -- "\${DOWNLOAD_DIR}/images.tsv" "\${DOWNLOAD_DIR}/request.json" \
    "\${DOWNLOAD_DIR}/node-\${NODE_ARCH}.tar.gz" \
    "\${DOWNLOAD_DIR}/haproxy-\${NODE_ARCH}.tar.gz" \
    "\${DOWNLOAD_DIR}/caddy-\${NODE_ARCH}.tar.gz"
  rmdir -- "$DOWNLOAD_DIR"
}
trap cleanup_downloads EXIT
case "$NODE_ARCH" in
${cases}
esac

# Finish and verify ALL downloads before importing an image or writing Node credentials.
while read -r filename checksum size image_id image_tag; do
  printf '{"token":"${downloads.token}","filename":"%s"}' "$filename" >"\${DOWNLOAD_DIR}/request.json"
  curl --fail --silent --show-error${downloads.panelOrigin.startsWith('https:') ? " --proto '=https'" : ''} \
    --connect-timeout 15 --max-time 1800 --retry 3 --retry-delay 2 --max-filesize "$size" \
    --request POST --header 'Content-Type: application/json' --data-binary "@\${DOWNLOAD_DIR}/request.json" \
    '${downloads.panelOrigin}${ARTIFACT_ROUTE}' --output "\${DOWNLOAD_DIR}/$filename"
  [[ "$(wc -c <"\${DOWNLOAD_DIR}/$filename")" -eq "$size" ]]
  (cd "$DOWNLOAD_DIR"; printf '%s  %s\\n' "$checksum" "$filename" | sha256sum -c >/dev/null)
done <"\${DOWNLOAD_DIR}/images.tsv"
while read -r filename checksum size image_id image_tag; do
  docker image load --input "\${DOWNLOAD_DIR}/$filename" >/dev/null
  [[ "$(docker image inspect --format '{{.Id}} {{.Os}}/{{.Architecture}}' "$image_tag")" == "$image_id linux/$NODE_ARCH" ]] || {
    echo "Loaded image identity does not match the panel manifest." >&2; exit 1;
  }
done <"\${DOWNLOAD_DIR}/images.tsv"
`;
}
