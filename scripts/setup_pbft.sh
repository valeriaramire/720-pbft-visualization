#!/usr/bin/env bash
set -euo pipefail


# ------ VARS -----------
CLIENTS=("client-1")
REPLICAS=("replica-1" "replica-2" "replica-3" "replica-4")
WANDLR_VERSION="wandlr"
SERVERS_VERSION="servers4.data" # servers.data
REPLICA_FILES=($WANDLR_VERSION "replica" "replica_json" "pbft_demo" "pbft_demo_json")
CLIENT_FILES=($WANDLR_VERSION "client" "client_json" "pbft_demo" "pbft_demo_json")

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_FILES_DIR="$BASE_DIR/remote-files"
# ------------------------

cd "$REMOTE_FILES_DIR"

# Construct configuration for the replicas and servers.
# mkdir -p configs
# ./genconf pbft replica-pbft.txt client-pbft.txt servers.data configs/pbft- '.txt'
# ./genconf pbft replica-pbft.txt client-pbft.txt $SERVERS_VERSION configs/pbft- '.txt'

# Copy files to the replicas and the clients.
for r in "${REPLICAS[@]}"; do
    # Remove existing files first
    ssh "$r" "rm -f ${REPLICA_FILES[*]}"
    # scp "configs/pbft-$r.txt" "$r:config-pbft-$r.txt"
    scp "${REPLICA_FILES[@]}" "$r:"
    ssh "$r" "chmod +x ${REPLICA_FILES[*]}"
done

echo "Copied all files to replicas."

# Copy files to the clients
for c in "${CLIENTS[@]}"; do
    # Remove existing files first
    ssh "$c" "rm -f ${CLIENT_FILES[*]}"
    # scp "configs/pbft-$c.txt" "$c:config-pbft-$c.txt"
    scp "${CLIENT_FILES[@]}" "$c:"
    ssh "$c" "chmod +x ${CLIENT_FILES[*]}"
done

echo "Copied all files to clients."
