#!/usr/bin/env bash
set -euo pipefail

# Official release assets, pinned by GitHub's published SHA-256 digests.
# This script runs on the Linux Actions runner; it does not build proxy cores.
client_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/rw-topology-binaries.XXXXXXXX")"
curl --fail --location --retry 3 --output "$client_dir/mihomo.gz" \
  'https://github.com/MetaCubeX/mihomo/releases/download/v1.19.30/mihomo-linux-amd64-v1-v1.19.30.gz'
printf '%s  %s\n' 'cbe553d0319a414bd3a372c5976a252155b2c4882b66bce88a4d6bba9571a553' "$client_dir/mihomo.gz" | sha256sum --check --strict
gzip --decompress "$client_dir/mihomo.gz"
chmod 700 "$client_dir/mihomo"

curl --fail --location --retry 3 --output "$client_dir/singbox.tar.gz" \
  'https://github.com/SagerNet/sing-box/releases/download/v1.14.0/sing-box-1.14.0-linux-amd64.tar.gz'
printf '%s  %s\n' '2375de6999f4f56ab46b4fc5ddf26a6aba1d3e61a0f4e7ddec2f4690457d5f63' "$client_dir/singbox.tar.gz" | sha256sum --check --strict
tar --extract --gzip --file "$client_dir/singbox.tar.gz" --directory "$client_dir" \
  --no-same-owner --no-same-permissions 'sing-box-1.14.0-linux-amd64/sing-box'
chmod 700 "$client_dir/sing-box-1.14.0-linux-amd64/sing-box"

export RW_TOPOLOGY_INTEGRATION=1
export RW_MIHOMO_BINARY="$client_dir/mihomo"
export RW_SINGBOX_BINARY="$client_dir/sing-box-1.14.0-linux-amd64/sing-box"
if [[ -n "${RW_TOPOLOGY_TEST_BUNDLE:-}" ]]; then
  node --test "$RW_TOPOLOGY_TEST_BUNDLE"
else
  npx tsx --test src/modules/subscription-template/generators/topology-clients.linux.test.ts
fi

if [[ -n "${RW_TOPOLOGY_EXPORT_DIR:-}" ]]; then
  mkdir -p "$RW_TOPOLOGY_EXPORT_DIR"
  cp "$RW_MIHOMO_BINARY" "$RW_TOPOLOGY_EXPORT_DIR/mihomo"
  cp "$RW_SINGBOX_BINARY" "$RW_TOPOLOGY_EXPORT_DIR/sing-box"
fi
