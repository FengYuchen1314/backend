#!/usr/bin/env bash
set -euo pipefail

# Run the Actions-compiled test runner with the production Node/dependency runtime.
# No build tools, host ports, host networking, Docker socket, or panel state are used.
runtime_image='ghcr.io/fengyuchen1314/backend@sha256:f1591532bdfd3c3ecf38cf098b78946c8de2224001070e91584e22de6bba5bd3'
test_dir="$(realpath -- "${1:?Pass the extracted private /opt/xboard-topology-test.* directory}")"
[[ "$test_dir" == /opt/xboard-topology-test.* && "$(dirname -- "$test_dir")" == /opt ]]
[[ -f "$test_dir/SOURCE_COMMIT" && -s "$test_dir/topology-clients.test.cjs" ]]
[[ -x "$test_dir/clients/mihomo" && -x "$test_dir/clients/sing-box" ]]
read -r source_commit < "$test_dir/SOURCE_COMMIT"
[[ "$source_commit" =~ ^[a-f0-9]{40}$ ]]
container="xboard-topology-$(basename -- "$test_dir")"
if docker container inspect "$container" >/dev/null 2>&1; then
  echo 'Refusing to replace an existing test container.' >&2
  exit 1
fi
docker image inspect "$runtime_image" >/dev/null 2>&1 || docker pull "$runtime_image"
trap 'docker container rm -f "$container" >/dev/null 2>&1 || true' EXIT
printf 'Testing Actions bundle from backend commit %s\n' "$source_commit"
docker run --rm --name "$container" \
  --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 128 --memory 512m --cpus 2 \
  --tmpfs /tmp:rw,nosuid,nodev,size=128m \
  --mount "type=bind,src=$test_dir,dst=/opt/topology-test,readonly" \
  --env NODE_PATH=/opt/app/node_modules \
  --env RW_TOPOLOGY_INTEGRATION=1 \
  --env RW_MIHOMO_BINARY=/opt/topology-test/clients/mihomo \
  --env RW_SINGBOX_BINARY=/opt/topology-test/clients/sing-box \
  --entrypoint /usr/local/bin/node "$runtime_image" \
  --test /opt/topology-test/topology-clients.test.cjs
printf 'VPS topology smoke tests passed; the disposable container was removed.\n'
