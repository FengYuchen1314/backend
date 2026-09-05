#!/usr/bin/env bash
set -euo pipefail
test_dir="$(realpath -- "${1:?Private extracted AnyTLS panel test directory required}")"
runtime_image="${2:?Verified backend image digest required}"
[[ "$test_dir" == /opt/xboard-anytls-panel-test.* && "$(dirname -- "$test_dir")" == /opt ]]
[[ "$runtime_image" =~ ^ghcr.io/fengyuchen1314/backend@sha256:[a-f0-9]{64}$ ]]
[[ -s "$test_dir/anytls-material.postgres.test.cjs" ]]
read -r source_commit < "$test_dir/SOURCE_COMMIT"
[[ "$source_commit" =~ ^[a-f0-9]{40}$ ]]
suffix="${test_dir##*.}"
[[ "$suffix" =~ ^[a-zA-Z0-9]{8}$ ]]
database="rw-anytls-db-$suffix"
network="rw-anytls-dbnet-$suffix"
migrator="rw-anytls-migrate-$suffix"
runner="rw-anytls-dbcases-$suffix"
for name in "$database" "$migrator" "$runner"; do
  if docker container inspect "$name" >/dev/null 2>&1; then echo 'Refusing to replace an existing container' >&2; exit 1; fi
done
if docker network inspect "$network" >/dev/null 2>&1; then echo 'Refusing to replace an existing network' >&2; exit 1; fi
docker image inspect "$runtime_image" >/dev/null
revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$runtime_image")"
[[ "$revision" == "$source_commit" ]]
docker image inspect postgres:17-alpine >/dev/null 2>&1 || docker pull postgres:17-alpine
network_id=''
database_id=''
cleanup() {
  if [[ -n "$database_id" ]]; then docker rm --force "$database_id" >/dev/null 2>&1 || true; fi
  if [[ -n "$network_id" ]]; then docker network rm "$network_id" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
network_id="$(docker network create --internal "$network")"
database_id="$(docker create --name "$database" --network "$network" \
  --pids-limit 128 --memory 512m --cpus 1 \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=256m \
  --env POSTGRES_USER=anytls_test --env POSTGRES_PASSWORD=disposable-test-password \
  --env POSTGRES_DB=anytls_test postgres:17-alpine)"
docker start "$database_id" >/dev/null
for attempt in $(seq 1 30); do
  # The image's temporary init server uses a Unix socket. Wait for the final TCP
  # listener so its init shutdown cannot be mistaken for database readiness.
  if docker exec "$database_id" pg_isready -h 127.0.0.1 -U anytls_test -d anytls_test >/dev/null; then break; fi
  sleep 1
done
docker exec "$database_id" pg_isready -h 127.0.0.1 -U anytls_test -d anytls_test
test_url="postgresql://anytls_test:disposable-test-password@$database:5432/anytls_test"
docker run --rm --name "$migrator" --network "$network" --read-only \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --memory 512m --cpus 2 \
  --tmpfs /tmp:rw,nosuid,nodev,size=128m \
  --env "DATABASE_URL=$test_url" --env "DIRECT_URL=$test_url" \
  --entrypoint /usr/local/bin/node "$runtime_image" /opt/app/node_modules/prisma/build/index.js migrate deploy
docker run --rm --name "$runner" --network "$network" --read-only \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --memory 512m --cpus 2 \
  --tmpfs /tmp:rw,nosuid,nodev,size=128m \
  --mount "type=bind,src=$test_dir,dst=/opt/anytls-panel-test,readonly" \
  --env NODE_PATH=/opt/app/node_modules --env "EDGE_DATABASE_TEST_URL=$test_url" \
  --entrypoint /usr/local/bin/node "$runtime_image" --test /opt/anytls-panel-test/anytls-material.postgres.test.cjs
printf 'PASS: full image migrations and compiled AnyTLS PostgreSQL identity acceptance in private disposable database\n'
