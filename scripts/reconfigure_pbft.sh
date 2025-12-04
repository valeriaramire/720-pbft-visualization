#!/usr/bin/env bash
set -euo pipefail

# This script reconfigures the PBFT setup
# to use the specified number of replicas.

if [ $# -lt 1 ]; then
    echo "Usage: $0 <num_replicas>"
    exit 1
fi

# ======== VARS ==========
N="$1"

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_FILES_DIR="$BASE_DIR/remote-files"
SERVERS_CUR="$REMOTE_FILES_DIR/servers.current.data"
# =======================

echo "========== PBFT Reconfigure: $N replicas =========="

# bash "$BASE_DIR/scripts/kill_pbft.sh" || echo "Warning: kill_pbft.sh returned non-zero."

bash "$BASE_DIR/scripts/make_servers_current.sh" "$N"

cd "$REMOTE_FILES_DIR"

mkdir -p configs

./genconf pbft replica-pbft.txt client-pbft.txt \
    "$SERVERS_CUR" configs/pbft- '.txt'

cd -

bash "$BASE_DIR/scripts/setup_pbft.sh"

echo "========== PBFT Reconfigure complete =========="
