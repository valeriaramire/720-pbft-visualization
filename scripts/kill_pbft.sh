#!/usr/bin/env bash
set -euo pipefail

# This script kills all pbft_demo_json and wandlr processes
# on the PBFT replicas and clients.

# ------ VARS -----------
WANDLR_VERSION="wandlr"

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_FILES_DIR="$BASE_DIR/remote-files"
SERVERS_CUR="$REMOTE_FILES_DIR/servers.current.data"

# Extract active replicas from servers.current.data
mapfile -t REPLICAS < <(
    awk '!/^#/ && /^\(replica-/{ sub(/^\(/,"",$1); print $1 }' "$SERVERS_CUR"
)
CLIENTS=("client-1") # single client assumed
# ------------------------

echo "Killing all pbft_demo_json and wandlr processes on replicas and clients..."
for server in "${REPLICAS[@]}" "${CLIENTS[@]}"; do
    echo "Killing processes on $server"
    ssh "$server" "pkill -9 pbft_demo_json || true; pkill -9 $WANDLR_VERSION || true" || true
done

# Verify processes have been killed
echo "Verifying that processes have been killed..."
for server in "${REPLICAS[@]}" "${CLIENTS[@]}"; do
    echo "=== Checking $server ==="
    ssh "$server" "ps aux | grep -E 'pbft_demo_json|$WANDLR_VERSION' | grep -v grep || echo 'No matching processes found.'" || true
done

echo "Killed all pbft_demo_json and wandlr processes."