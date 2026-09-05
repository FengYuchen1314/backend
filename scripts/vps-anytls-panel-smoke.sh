#!/usr/bin/env bash
set -euo pipefail

# Only an Actions-compiled bundle and a digest-pinned production dependency runtime.
# No host ports/network/socket, panel database, installation or application compilation.
test_dir="$(realpath -- "${1:?Pass the extracted private /opt/xboard-anytls-panel-test.* directory}")"
runtime_image="${2:?Pass the verified Actions backend image digest}"
[[ "$test_dir" == /opt/xboard-anytls-panel-test.* && "$(dirname -- "$test_dir")" == /opt ]]
[[ "$runtime_image" =~ ^ghcr.io/fengyuchen1314/backend@sha256:[a-f0-9]{64}$ ]]
[[ -f "$test_dir/SOURCE_COMMIT" && -s "$test_dir/anytls-panel.test.cjs" ]]
read -r source_commit < "$test_dir/SOURCE_COMMIT"
[[ "$source_commit" =~ ^[a-f0-9]{40}$ ]]
container="xboard-anytls-panel-$(basename -- "$test_dir")"
if docker container inspect "$container" >/dev/null 2>&1; then
  echo 'Refusing to replace an existing test container.' >&2
  exit 1
fi
docker image inspect "$runtime_image" >/dev/null 2>&1 || docker pull "$runtime_image"
trap 'docker container rm -f "$container" >/dev/null 2>&1 || true' EXIT
printf 'Testing Actions backend AnyTLS preparation bundle from %s\n' "$source_commit"
docker run --rm --name "$container" \
  --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 128 --memory 512m --cpus 2 \
  --tmpfs /tmp:rw,nosuid,nodev,size=128m \
  --mount "type=bind,src=$test_dir,dst=/opt/anytls-panel-test,readonly" \
  --env NODE_PATH=/opt/app/node_modules \
  --entrypoint /usr/local/bin/node "$runtime_image" \
  --test /opt/anytls-panel-test/anytls-panel.test.cjs
printf 'VPS AnyTLS panel preparation tests passed; disposable container removed.\n'
