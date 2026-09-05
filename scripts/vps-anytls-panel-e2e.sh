#!/usr/bin/env bash
# Owned disposable full panel/Agent/client acceptance. No application compilation.
set -euo pipefail
umask 077
test "$(id -u)" = 0
task_dir=$(pwd -P)
[[ "$task_dir" =~ ^/opt/xboard-anytls-e2e\.[A-Za-z0-9]{8}$ ]]
test ! -e panel.env
for file in vps-anytls-panel-e2e.mjs vps-anytls-panel-e2e-client.mjs mihomo-test-readiness.mjs; do test -s "$file"; done
panel_image='ghcr.io/fengyuchen1314/backend@sha256:13c84f2c2ab23442ba75ac640c2b1cde046942a0ff9439eb228052ef59721acc'
node_image='ghcr.io/fengyuchen1314/node@sha256:3293d71dcab6838d470e3da70bd56661509847fef5966adafffe6ff1f8dfd286'
postgres_image='postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73'
valkey_image='valkey/valkey@sha256:ccfa19b0d743e48927e1c8c14e39e0acb97b5cea347fef0bfe340247fea920cd'
haproxy_image='haproxy@sha256:6343ce34a132a5dceaa24767d739df2bd519f8f7c1079ae39e4821334e8eb42e'
caddy_image='caddy@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648'
prefix="rw-${task_dir##*/}"
for suffix in db redis panel proxy anchor agent haproxy caddy; do
  if docker container inspect "$prefix-$suffix" >/dev/null 2>&1; then echo 'Refusing to reuse a container' >&2; exit 1; fi
done
if docker network inspect "$prefix" >/dev/null 2>&1; then echo 'Refusing to reuse a network' >&2; exit 1; fi
for image in "$panel_image" "$node_image" "$postgres_image" "$valkey_image" "$haproxy_image" "$caddy_image"; do
  docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image"
done
docker ps --quiet --no-trunc | sort > containers-before.txt
test "$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:38100)" = 200
created=()
network_id=''
cleanup() {
  local result=$?
  trap - EXIT
  for ((index=${#created[@]}-1; index>=0; index--)); do
    name="${created[index]}"
    if docker container inspect "$name" >/dev/null 2>&1; then
      test "$(docker inspect "$name" --format '{{index .Config.Labels "io.xboard.acceptance"}}')" = "$prefix" || exit 1
      docker logs "$name" > "$name.log" 2>&1 || true
      docker rm --force --volumes "$name" >/dev/null || result=1
    fi
  done
  if [[ -n "$network_id" ]]; then docker network rm "$network_id" >/dev/null || result=1; fi
  docker ps --quiet --no-trunc | sort > containers-after.txt
  cmp containers-before.txt containers-after.txt || result=1
  test "$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:38100)" = 200 || result=1
  echo "E2E acceptance exit=$result; only labelled fixture containers removed; evidence retained."
  exit "$result"
}
trap cleanup EXIT
docker run --rm --network none --entrypoint node --mount "type=bind,src=$task_dir,dst=/test" "$panel_image" /test/vps-anytls-panel-e2e.mjs setup
network_id=$(docker network create --internal --label "io.xboard.acceptance=$prefix" "$prefix")
docker run -d --name "$prefix-db" --network "$prefix" --network-alias db --label "io.xboard.acceptance=$prefix" \
  --memory 512m --cpus 1 --pids-limit 128 --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=256m \
  --env-file "$task_dir/db.env" "$postgres_image" >/dev/null
created+=("$prefix-db")
for attempt in $(seq 1 40); do
  if docker exec "$prefix-db" pg_isready -h 127.0.0.1 -U panel_test -d panel_test >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$prefix-db" pg_isready -h 127.0.0.1 -U panel_test -d panel_test
docker run -d --name "$prefix-redis" --network "$prefix" --network-alias redis --label "io.xboard.acceptance=$prefix" \
  --memory 128m --cpus 1 --pids-limit 64 "$valkey_image" valkey-server --save '' --appendonly no --maxmemory 96mb --maxmemory-policy noeviction >/dev/null
created+=("$prefix-redis")
docker run -d --name "$prefix-panel" --network "$prefix" --network-alias panel --label "io.xboard.acceptance=$prefix" \
  --memory 2g --cpus 2 --pids-limit 512 --env-file "$task_dir/panel.env" -v "$task_dir:/test" "$panel_image" >/dev/null
created+=("$prefix-panel")
docker run -d --name "$prefix-proxy" --network "$prefix" --network-alias proxy --label "io.xboard.acceptance=$prefix" \
  --memory 128m --cpus 1 --pids-limit 64 --read-only --cap-drop ALL --security-opt no-new-privileges \
  -v "$task_dir:/test:ro" --entrypoint node "$panel_image" /test/vps-anytls-panel-e2e.mjs proxy >/dev/null
created+=("$prefix-proxy")
docker exec "$prefix-panel" node /test/vps-anytls-panel-e2e.mjs register
# Only the Agent namespace has outbound Internet for verified public camouflage
# and the public HTTP target. Panel, PostgreSQL and Valkey stay on an internal net.
docker run -d --name "$prefix-anchor" --network bridge --label "io.xboard.acceptance=$prefix" \
  --read-only --cap-drop ALL --security-opt no-new-privileges --memory 32m --pids-limit 16 \
  --entrypoint sleep "$node_image" infinity >/dev/null
created+=("$prefix-anchor")
docker network connect --alias agent "$prefix" "$prefix-anchor"
docker run -d --name "$prefix-caddy" --network "container:$prefix-anchor" --label "io.xboard.acceptance=$prefix" \
  --memory 128m --pids-limit 64 --user 0:0 -v "$task_dir/edge/Caddyfile:/etc/caddy/Caddyfile:ro" \
  "$caddy_image" caddy run --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
created+=("$prefix-caddy")
docker run -d --name "$prefix-haproxy" --network "container:$prefix-anchor" --label "io.xboard.acceptance=$prefix" \
  --memory 128m --pids-limit 64 --user 0:0 -v "$task_dir/edge:/usr/local/etc/haproxy:ro" -v "$task_dir/edge/run:/run/edge" \
  "$haproxy_image" haproxy -W -db -f /usr/local/etc/haproxy/haproxy.cfg -S /run/edge/master.sock,uid,0,gid,0,mode,600 >/dev/null
created+=("$prefix-haproxy")
mkdir -m 700 agent-state
docker run -d --name "$prefix-agent" --network "container:$prefix-anchor" --label "io.xboard.acceptance=$prefix" \
  --cap-add NET_ADMIN --pids-limit 256 --memory 768m --cpus 2 --env-file "$task_dir/agent.env" \
  -v "$task_dir:/test" -v "$task_dir/agent-state:/var/lib/remnanode" "$node_image" >/dev/null
created+=("$prefix-agent")
for name in "${created[@]}"; do
  test "$(docker inspect "$name" --format '{{len .HostConfig.PortBindings}}')" = 0
  test -z "$(docker inspect "$name" --format '{{.HostConfig.PidMode}}')"
done
docker exec "$prefix-panel" node /test/vps-anytls-panel-e2e.mjs configure
docker exec "$prefix-agent" node /test/vps-anytls-panel-e2e-client.mjs
docker exec "$prefix-panel" node /test/vps-anytls-panel-e2e.mjs verify
docker restart --timeout 30 "$prefix-agent" >/dev/null
docker exec "$prefix-panel" node /test/vps-anytls-panel-e2e.mjs reconcile
docker exec "$prefix-panel" node /test/vps-anytls-panel-e2e.mjs verify
echo 'PASS: real panel subscription, encrypted native client, scheduled billing and Agent restart; not managed-creation/UI/installer or public ACME acceptance'
