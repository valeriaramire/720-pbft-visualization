#!/usr/bin/env bash
set -euo pipefail

# ------ VARS -----------
WANDLR_VERSION="wandlr"
# REPLICA_FILES=($WANDLR_VERSION "replica" "replica_json" "pbft_demo" "pbft_demo_json")
# CLIENT_FILES=($WANDLR_VERSION "client" "client_json" "pbft_demo" "pbft_demo_json")
REPLICA_FILES=($WANDLR_VERSION "replica" "pbft_demo_json")
CLIENT_FILES=($WANDLR_VERSION "client" "pbft_demo_json")

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_FILES_DIR="$BASE_DIR/remote-files"
SERVERS_CUR="$REMOTE_FILES_DIR/servers.current.data"
CONFIGS_DIR="$REMOTE_FILES_DIR/configs"
# ------------------------

cd "$REMOTE_FILES_DIR"

echo "[setup_pbft] Setting up PBFT replicas and clients..."

# Extract active replicas from servers.current.data
mapfile -t REPLICAS < <(
    awk '!/^#/ && /^\(replica-/{ sub(/^\(/,"",$1); print $1 }' "$SERVERS_CUR"
)

CLIENTS=("client-1") # single client assumed

echo "Active replicas: ${REPLICAS[*]}"
echo "Client: ${CLIENTS[*]}"

cd "$REMOTE_FILES_DIR"

# Copy files to the replicas
for r in "${REPLICAS[@]}"; do
    echo "---- $r ----"
    # Remove existing files first
    ssh "$r" "rm -f ${REPLICA_FILES[*]} config-pbft-$r.txt" || true
    
    # Copy files
    scp "${REPLICA_FILES[@]}" "$r:"
    scp "$CONFIGS_DIR/pbft-$r.txt" "$r:config-pbft-$r.txt"
    ssh "$r" "chmod +x ${REPLICA_FILES[*]}" || true
done

echo "Copied all files to replicas."

# Copy files to the clients
for c in "${CLIENTS[@]}"; do
    echo "---- $c ----"
    # Remove existing files first
    ssh "$c" "rm -f ${CLIENT_FILES[*]} config-pbft-$c.txt" || true

    # Copy files
    scp "${CLIENT_FILES[@]}" "$c:"
    scp "$CONFIGS_DIR/pbft-$c.txt" "$c:config-pbft-$c.txt"
    ssh "$c" "chmod +x ${CLIENT_FILES[*]}" || true
done

echo "Copied all files to clients."
