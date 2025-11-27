#!/usr/bin/env bash
set -euo pipefail


# ------ VARS -----------
CLIENTS=("client-1")
REPLICAS=("replica-1" "replica-2" "replica-3" "replica-4")
WANDLR_VERSION="wandlr_fixed"
# ------------------------


# Construct configuration for the replicas and servers.
mkdir -p configs
# ./genconf pbft replica-pbft.txt client-pbft.txt servers.data configs/pbft- '.txt'
./genconf pbft replica-pbft.txt client-pbft.txt servers4.data configs/pbft- '.txt'

# Copy files to the replicas and the clients.
for t in ${REPLICAS[@]}; do
    # Remove existing files first
    ssh "$t" "rm -f $WANDLR_VERSION replica replica_json pbft_demo pbft_demo_json"
    scp configs/pbft-$t.txt $t:config-pbft-$t.txt
    scp replica $t:replica
    scp replica_json $t:replica_json
    scp pbft_demo $t:pbft_demo
    scp pbft_demo_json $t:pbft_demo_json
    scp $WANDLR_VERSION $t:$WANDLR_VERSION
    ssh "$t" "chmod +x pbft_demo_json $WANDLR_VERSION replica replica_json pbft_demo pbft_demo_json"
done

echo "Copied all files to replicas."

# Copy files to the clients
for c in ${CLIENTS[@]}; do
    # Remove existing files first
    ssh "$c" "rm -f $WANDLR_VERSION client client_json pbft_demo pbft_demo_json"
    scp configs/pbft-$c.txt $c:config-pbft-$c.txt
    scp client $c:client
    scp client_json $c:client_json
    scp pbft_demo $c:pbft_demo
    scp pbft_demo_json $c:pbft_demo_json
    scp $WANDLR_VERSION $c:$WANDLR_VERSION
    ssh "$c" "chmod +x pbft_demo_json $WANDLR_VERSION client client_json pbft_demo pbft_demo_json"
done

echo "Copied all files to clients."