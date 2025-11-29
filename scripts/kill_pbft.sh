#!/usr/bin/env bash
set -euo pipefail


# ------ VARS -----------
CLIENTS=("client-1")
REPLICAS=("replica-1" "replica-2" "replica-3" "replica-4")
WANDLR_VERSION="wandlr"
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