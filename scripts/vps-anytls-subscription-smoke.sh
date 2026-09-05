#!/usr/bin/env bash
set -euo pipefail

# Actions builds the code and supplies checksum-verified native clients. The VPS
# only runs it in an isolated container; no host service/configuration is touched.
runtime_image='ghcr.io/fengyuchen1314/backend@sha256:429d75ac4838702ff9fe9e00b659b97fe7fb4ace331561dc01cfb9f2ab9037d1'
test_dir="$(realpath -- "${1:?Pass the extracted private /opt/xboard-anytls-subscription-test.* directory}")"
[[ "$test_dir" =~ ^/opt/xboard-anytls-subscription-test\.[A-Za-z0-9]{8}$ ]]
[[ -s "$test_dir/SOURCE_COMMIT" && -s "$test_dir/anytls-clients.test.cjs" ]]
[[ -s "$test_dir/anytls-panel.test.cjs" && -s "$test_dir/topology-clients.test.cjs" ]]
[[ -x "$test_dir/clients/mihomo" && -x "$test_dir/clients/sing-box" ]]
read -r source_commit < "$test_dir/SOURCE_COMMIT"
[[ "$source_commit" =~ ^[a-f0-9]{40}$ ]]
container="xboard-anytls-subscription-$(basename -- "$test_dir")"
if docker container inspect "$container" >/dev/null 2>&1; then
  echo 'Refusing to replace an existing test container.' >&2
  exit 1
fi
docker image inspect "$runtime_image" >/dev/null 2>&1 || docker pull "$runtime_image"
trap 'docker container rm -f "$container" >/dev/null 2>&1 || true' EXIT
printf 'Testing Actions AnyTLS subscription bundle from backend commit %s\n' "$source_commit"
docker run --rm --name "$container" \
  --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 256 --memory 768m --cpus 2 \
  --tmpfs /tmp:rw,nosuid,nodev,size=128m \
  --mount "type=bind,src=$test_dir,dst=/opt/subscription-test,readonly" \
  --env NODE_PATH=/opt/app/node_modules \
  --env RW_TOPOLOGY_INTEGRATION=1 \
  --env RW_MIHOMO_BINARY=/opt/subscription-test/clients/mihomo \
  --env RW_SINGBOX_BINARY=/opt/subscription-test/clients/sing-box \
  --entrypoint /usr/local/bin/node "$runtime_image" \
  --test /opt/subscription-test/anytls-clients.test.cjs \
  /opt/subscription-test/anytls-panel.test.cjs /opt/subscription-test/topology-clients.test.cjs
printf 'VPS encrypted AnyTLS subscription tests passed; the disposable container was removed.\n'
