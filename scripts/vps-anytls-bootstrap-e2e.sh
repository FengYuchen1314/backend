#!/usr/bin/env bash
# Run only Actions-built applications in an owned private engine. No host socket,
# host ports/PID/network, existing data mounts, application build or registry fallback.
set -euo pipefail
umask 077
task_dir=$(pwd -P)
[[ "$task_dir" =~ ^/opt/xboard-anytls-bootstrap\.[A-Za-z0-9]{8}$ ]]
test "$(id -u)" = 0
panel_image="${1:?Exact successful Actions image}"
backend_commit="${2:?Exact successful Actions source}"
creation_mode="${3:-external}"
[[ "$panel_image" =~ ^ghcr.io/fengyuchen1314/backend@sha256:[a-f0-9]{64}$ ]]
[[ "$backend_commit" =~ ^[a-f0-9]{40}$ ]]
[[ "$creation_mode" == external || "$creation_mode" == managed ]]
test ! -e panel.env
prefix="rw-${task_dir##*/}"
engine="$prefix-engine"
postgres_image='postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73'
valkey_image='valkey/valkey@sha256:ccfa19b0d743e48927e1c8c14e39e0acb97b5cea347fef0bfe340247fea920cd'
engine_image='docker.io/library/docker@sha256:6acc6aaf783ac1c1100822e542534c3dab3f1d38782760b0bdcb688280574d9e'
for suffix in db redis panel proxy engine relay; do
  if docker inspect "$prefix-$suffix" >/dev/null 2>&1; then echo 'Refusing to reuse fixture containers' >&2; exit 1; fi
done
if docker network inspect "$prefix" >/dev/null 2>&1 || docker volume inspect "$prefix-data" >/dev/null 2>&1; then exit 1; fi
for image in "$panel_image" "$postgres_image" "$valkey_image" "$engine_image"; do
  docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image"
done
for file in vps-anytls-panel-e2e.mjs vps-anytls-panel-e2e-client.mjs mihomo-test-readiness.mjs vps-anytls-bootstrap-relay.mjs; do test -s "$file"; done
docker ps --quiet --no-trunc | sort > containers-before.txt
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:38100/)" = 200
created=()
network_id=''
volume_created=false
cleanup() {
  local result=$?
  trap - EXIT
  if docker inspect "$engine" >/dev/null 2>&1 && docker exec "$engine" docker info >/dev/null 2>&1; then
    for name in remnanode xboard-edge-haproxy xboard-edge-caddy; do
      docker exec "$engine" docker logs "$name" > "$name.log" 2>&1 || true
    done
  fi
  for ((index=${#created[@]}-1; index>=0; index--)); do
    name="${created[index]}"
    if docker inspect "$name" >/dev/null 2>&1; then
      test "$(docker inspect "$name" --format '{{index .Config.Labels "io.xboard.acceptance"}}')" = "$prefix" || exit 1
      docker logs "$name" > "$name.log" 2>&1 || true
      docker rm --force --volumes "$name" >/dev/null || result=1
    fi
  done
  if [[ "$volume_created" == true ]]; then
    test "$(docker volume inspect "$prefix-data" --format '{{index .Labels "io.xboard.acceptance"}}')" = "$prefix" || exit 1
    docker volume rm "$prefix-data" >/dev/null || result=1
  fi
  if [[ -n "$network_id" ]]; then docker network rm "$network_id" >/dev/null || result=1; fi
  docker ps --quiet --no-trunc | sort > containers-after.txt
  cmp containers-before.txt containers-after.txt || result=1
  test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:38100/)" = 200 || result=1
  echo "Bootstrap E2E exit=$result; only labelled private fixtures removed; evidence retained."
  exit "$result"
}
trap cleanup EXIT
docker run --rm --network none --entrypoint node --mount "type=bind,src=$task_dir,dst=/test" \
  --env "E2E_EXPECTED_BACKEND_COMMIT=$backend_commit" --env E2E_BOOTSTRAP=true \
  "$panel_image" /test/vps-anytls-panel-e2e.mjs setup
network_id=$(docker network create --internal --label "io.xboard.acceptance=$prefix" "$prefix")
docker run -d --name "$prefix-db" --network "$prefix" --network-alias db --label "io.xboard.acceptance=$prefix" \
  --memory 512m --pids-limit 128 --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=256m --env-file "$task_dir/db.env" "$postgres_image" >/dev/null
created+=("$prefix-db")
for attempt in $(seq 1 40); do
  if docker exec "$prefix-db" pg_isready -h 127.0.0.1 -U panel_test -d panel_test >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$prefix-db" pg_isready -h 127.0.0.1 -U panel_test -d panel_test
docker run -d --name "$prefix-redis" --network "$prefix" --network-alias redis --label "io.xboard.acceptance=$prefix" \
  --memory 128m --pids-limit 64 "$valkey_image" valkey-server --save '' --appendonly no --maxmemory 96mb --maxmemory-policy noeviction >/dev/null
created+=("$prefix-redis")
docker run -d --name "$prefix-panel" --network "$prefix" --network-alias panel --label "io.xboard.acceptance=$prefix" \
  --memory 2g --cpus 2 --pids-limit 512 --env-file "$task_dir/panel.env" -v "$task_dir:/test" "$panel_image" >/dev/null
created+=("$prefix-panel")
docker run -d --name "$prefix-proxy" --network "$prefix" --network-alias proxy --label "io.xboard.acceptance=$prefix" \
  --memory 128m --pids-limit 64 --read-only --cap-drop ALL --security-opt no-new-privileges \
  -v "$task_dir:/test:ro" --entrypoint node "$panel_image" /test/vps-anytls-panel-e2e.mjs proxy >/dev/null
created+=("$prefix-proxy")
docker exec "$prefix-panel" node /test/vps-anytls-panel-e2e.mjs register
docker volume create --label "io.xboard.acceptance=$prefix" "$prefix-data" >/dev/null
volume_created=true
docker run -d --name "$engine" --label "io.xboard.acceptance=$prefix" --privileged \
  --memory 3g --cpus 2 --pids-limit 1024 --network bridge \
  --mount "type=volume,src=$prefix-data,dst=/var/lib/docker" --entrypoint dockerd "$engine_image" \
  --host=unix:///var/run/docker.sock --storage-driver=vfs --bridge=none --iptables=false --ip-forward=false --ip-masq=false >/dev/null
created+=("$engine")
for attempt in $(seq 1 40); do
  if docker exec "$engine" docker info >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$engine" docker info >/dev/null
# OS prerequisites are fixture setup, before the Agent installation and egress cutoff.
docker exec "$engine" apk add --no-cache bash curl >/dev/null
docker network connect --alias agent "$prefix" "$engine"
docker network disconnect bridge "$engine"
test "$(docker inspect "$engine" --format '{{range $name, $value := .NetworkSettings.Networks}}{{$name}}{{end}}')" = "$prefix"
if docker exec "$engine" curl -s --connect-timeout 3 --max-time 5 https://ghcr.io/v2/ -o /dev/null; then exit 1; fi
test -z "$(docker exec "$engine" docker image ls --quiet)"
test -z "$(docker exec "$engine" docker container ls --all --quiet)"
mkdir -m 700 tls
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 1 -subj /CN=localhost \
  -addext subjectAltName=DNS:localhost -addext basicConstraints=critical,CA:TRUE \
  -keyout tls/key.pem -out tls/cert.pem >/dev/null 2>&1
docker cp tls/cert.pem "$engine:/tmp/panel-test-ca.pem"
docker run -d --name "$prefix-relay" --network "container:$engine" --label "io.xboard.acceptance=$prefix" \
  --memory 128m --pids-limit 64 --read-only --cap-drop ALL --security-opt no-new-privileges \
  -v "$task_dir/tls:/tls:ro" -v "$task_dir:/test:ro" --entrypoint node "$panel_image" /test/vps-anytls-bootstrap-relay.mjs >/dev/null
created+=("$prefix-relay")
for attempt in $(seq 1 25); do
  if docker exec "$engine" curl -fs --cacert /tmp/panel-test-ca.pem https://localhost:34445/api/auth/status -o /dev/null; then break; fi
  sleep 1
done
docker exec "$engine" curl -fs --cacert /tmp/panel-test-ca.pem https://localhost:34445/api/auth/status -o /dev/null
for name in "${created[@]}"; do
  test "$(docker inspect "$name" --format '{{len .HostConfig.PortBindings}}')" = 0
  test -z "$(docker inspect "$name" --format '{{.HostConfig.PidMode}}')"
done
docker exec "$prefix-panel" node /test/vps-anytls-panel-e2e.mjs grant-bootstrap
docker cp bootstrap-entry.sh "$engine:/tmp/bootstrap-entry.sh"
docker exec -e CURL_CA_BUNDLE=/tmp/panel-test-ca.pem "$engine" bash /tmp/bootstrap-entry.sh
docker exec "$engine" docker exec remnanode node -e 'const assert=require("node:assert/strict"); assert.equal(process.env.ANYTLS_ENABLED,"true"); assert.equal(process.env.ANYTLS_STATE_DIR,"/var/lib/remnanode/anytls"); console.log("PASS: original panel-only installer enabled encrypted runtime without registry access");'
old_id=$(docker exec "$engine" docker inspect remnanode --format '{{.Id}}')
state_volume=$(docker exec "$engine" docker inspect remnanode --format '{{range .Mounts}}{{if eq .Destination "/var/lib/remnanode"}}{{.Name}}{{end}}{{end}}')
test -n "$state_volume"
docker exec "$engine" docker volume inspect "$state_volume" >/dev/null
# Only after panel-only installation is proven, permit public camouflage and test TCP egress.
docker network connect bridge "$engine"
copy_client_sources() {
  docker exec "$engine" docker exec remnanode mkdir -m 700 /test
  for file in vps-anytls-panel-e2e.mjs vps-anytls-panel-e2e-client.mjs mihomo-test-readiness.mjs; do
    docker cp "$file" "$engine:/tmp/$file"
    docker exec "$engine" docker cp "/tmp/$file" "remnanode:/test/$file"
  done
}
copy_client_sources
docker exec "$engine" docker exec remnanode node /test/vps-anytls-panel-e2e.mjs installed-certificate
docker exec "$engine" docker exec remnanode node /test/vps-anytls-panel-e2e.mjs resolve-camouflage
for file in installed-agent-cert.pem camouflage.json; do
  docker exec "$engine" docker cp "remnanode:/test/$file" "/tmp/$file"
  docker cp "$engine:/tmp/$file" "$task_dir/$file"
done
managed=false
if [[ "$creation_mode" == managed ]]; then managed=true; fi
docker exec --env "E2E_MANAGED_CREATION=$managed" "$prefix-panel" node /test/vps-anytls-panel-e2e.mjs configure
copy_subscription() {
  docker cp subscription-proxies.json "$engine:/tmp/subscription-proxies.json"
  docker exec "$engine" docker cp /tmp/subscription-proxies.json remnanode:/test/subscription-proxies.json
}
copy_subscription
docker exec "$engine" docker exec remnanode node /test/vps-anytls-panel-e2e-client.mjs
docker exec --env E2E_BOOTSTRAP=true "$prefix-panel" node /test/vps-anytls-panel-e2e.mjs verify
docker exec "$engine" docker compose --project-directory /opt/remnanode --file /opt/remnanode/compose.yml up --detach --force-recreate --no-deps --pull never --no-build remnanode
test "$(docker exec "$engine" docker inspect remnanode --format '{{.Id}}')" != "$old_id"
test "$(docker exec "$engine" docker inspect remnanode --format '{{range .Mounts}}{{if eq .Destination "/var/lib/remnanode"}}{{.Name}}{{end}}{{end}}')" = "$state_volume"
docker exec "$prefix-panel" node /test/vps-anytls-panel-e2e.mjs reconcile
docker exec --env E2E_BOOTSTRAP=true "$prefix-panel" node /test/vps-anytls-panel-e2e.mjs verify
copy_client_sources
copy_subscription
docker exec "$engine" docker exec remnanode node /test/vps-anytls-panel-e2e-client.mjs
docker exec --env E2E_BOOTSTRAP=true "$prefix-panel" node /test/vps-anytls-panel-e2e.mjs verify-new-traffic
echo "PASS: panel-only original installer, native encrypted subscription, scheduled billing, named-volume container replacement and further traffic; creation=$creation_mode; not browser/public ACME/UDP acceptance"
