#!/usr/bin/env bash
set -euo pipefail


# ------ VARS -----------
CLIENTS=("client-1")
REPLICAS=("replica-1" "replica-2" "replica-3" "replica-4")
WANDLR_URL="https://jhellings.nl/castest.php"
KAFKA_PROXY="192.168.175.117:8082"
KAFKA_TOPIC="pbft-logs"
# CLIENT_ID=4
CLIENT_WAIT=10
# ------------------------


# Construct configuration for the replicas and servers.
mkdir -p configs
./genconf pbft replica-pbft.txt client-pbft.txt servers.data configs/pbft- '.txt'

# Copy files to the replicas and the clients.
for t in ${REPLICAS[@]}; do
    # Remove existing files first
    ssh "$t" "rm -f wandlr replica replica_json pbft_demo pbft_demo_json"
    scp configs/pbft-$t.txt $t:config-pbft-$t.txt
    scp replica $t:replica
    scp replica_json $t:replica_json
    scp pbft_demo $t:pbft_demo
    scp pbft_demo_json $t:pbft_demo_json
    scp wandlr $t:wandlr
    ssh "$t" "chmod +x pbft_demo_json wandlr replica replica_json pbft_demo pbft_demo_json"
done

# Copy files to the clients
for c in ${CLIENTS[@]}; do
    # Remove existing files first
    ssh "$c" "rm -f wandlr client client_json pbft_demo pbft_demo_json"
    scp configs/pbft-$c.txt $c:config-pbft-$c.txt
    scp client $c:client
    scp client_json $c:client_json
    scp pbft_demo $c:pbft_demo
    scp pbft_demo_json $c:pbft_demo_json
    scp wandlr $c:wandlr
    ssh "$c" "chmod +x pbft_demo_json wandlr client client_json pbft_demo pbft_demo_json"
done

# Start the replicas and the clients.
for i in ${!REPLICAS[@]}; do
    t=${REPLICAS[$i]}
    idx=$((i+1))
    ssh $t "nohup ./pbft_demo_json replica config-pbft-$t.txt \
        | ./wandlr lr http://$KAFKA_PROXY/topics/$KAFKA_TOPIC $idx \
        > replica_output.log 2>&1 &" &
done

sleep 5

# single-shot 
for i in ${!CLIENTS[@]}; do
    c=${CLIENTS[$i]}
    idx=$((i+1))
    ssh $c "nohup sh -c '
        ./wandlr w $WANDLR_URL $idx $CLIENT_WAIT \
        | head -n 1 \
        | ./pbft_demo_json client-cert config-pbft-$c.txt \
        | ./wandlr lr http://$KAFKA_PROXY/topics/$KAFKA_TOPIC $idx
        ' > client_output.log 2>&1 &" &
done

# for i in ${!CLIENTS[@]}; do
#     c=${CLIENTS[$i]}
#     idx=$((i+1))
#     ssh $c "nohup ./wandlr w $WANDLR_URL $idx $CLIENT_WAIT \
#         | ./pbft_demo_json client-cert config-pbft-$c.txt \
#         | ./wandlr lr http://$KAFKA_PROXY/topics/$KAFKA_TOPIC $idx \
#         > client_output.log 2>&1 &" &
# done

# SLEEP AND KILL FOR MIDTERM DEMO
echo "Sleeping for 300 seconds to allow demo to run..."
sleep 300

echo "Killing all pbft_demo_json and wandlr processes on replicas and clients..."
for server in "${REPLICAS[@]}" "${CLIENTS[@]}"; do
    echo "Killing processes on $server"
    ssh "$server" "pkill -9 pbft_demo_json || true; pkill -9 wandlr || true" || true
done

# Verify processes have been killed
echo "Verifying that processes have been killed..."
for server in "${REPLICAS[@]}" "${CLIENTS[@]}"; do
    echo "=== Checking $server ==="
    ssh "$server" "ps aux | grep -E 'pbft_demo_json|wandlr' | grep -v grep || echo 'No matching processes found.'" || true
done

echo "Script Done."
