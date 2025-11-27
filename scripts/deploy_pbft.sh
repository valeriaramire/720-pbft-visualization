#!/usr/bin/env bash
set -euo pipefail


# ------ VARS -----------
CLIENTS=("client-1")
REPLICAS=("replica-1" "replica-2" "replica-3" "replica-4")
WANDLR_URL="http://192.168.175.117:8002/castest"
KAFKA_PROXY="192.168.175.117:8082"
KAFKA_TOPIC="pbft-logs"
WANDLR_VERSION="wandlr_fixed"
# CLIENT_ID=4
CLIENT_WAIT=10

# Single or Multi-shot?
SINGLE_OR_MULTI="single"
# SINGLE_OR_MULTI="multi"
SLEEP_DURATION=5
# ------------------------


# # Construct configuration for the replicas and servers.
# mkdir -p configs
# # ./genconf pbft replica-pbft.txt client-pbft.txt servers.data configs/pbft- '.txt'
# ./genconf pbft replica-pbft.txt client-pbft.txt servers4.data configs/pbft- '.txt'

# # Copy files to the replicas and the clients.
# for t in ${REPLICAS[@]}; do
#     # Remove existing files first
#     ssh "$t" "rm -f $WANDLR_VERSION replica replica_json pbft_demo pbft_demo_json"
#     scp configs/pbft-$t.txt $t:config-pbft-$t.txt
#     scp replica $t:replica
#     scp replica_json $t:replica_json
#     scp pbft_demo $t:pbft_demo
#     scp pbft_demo_json $t:pbft_demo_json
#     scp $WANDLR_VERSION $t:$WANDLR_VERSION
#     ssh "$t" "chmod +x pbft_demo_json $WANDLR_VERSION replica replica_json pbft_demo pbft_demo_json"
# done

# # Copy files to the clients
# for c in ${CLIENTS[@]}; do
#     # Remove existing files first
#     ssh "$c" "rm -f $WANDLR_VERSION client client_json pbft_demo pbft_demo_json"
#     scp configs/pbft-$c.txt $c:config-pbft-$c.txt
#     scp client $c:client
#     scp client_json $c:client_json
#     scp pbft_demo $c:pbft_demo
#     scp pbft_demo_json $c:pbft_demo_json
#     scp $WANDLR_VERSION $c:$WANDLR_VERSION
#     ssh "$c" "chmod +x pbft_demo_json $WANDLR_VERSION client client_json pbft_demo pbft_demo_json"
# done

# Start the replicas and the clients.
for i in ${!REPLICAS[@]}; do
    t=${REPLICAS[$i]}
    idx=$((i+1))
    ssh $t "nohup ./pbft_demo_json replica config-pbft-$t.txt \
        | ./$WANDLR_VERSION lr http://$KAFKA_PROXY/topics/$KAFKA_TOPIC $t \
        > replica_output.log 2>&1 &" > out.txt 2>&1 &
done

sleep 5

for i in ${!CLIENTS[@]}; do
    c=${CLIENTS[$i]}
    idx=$((i+1))
    ssh $c "nohup ./$WANDLR_VERSION w $WANDLR_URL $idx $CLIENT_WAIT $SINGLE_OR_MULTI \
        | ./pbft_demo_json client-cert config-pbft-$c.txt \
        | ./$WANDLR_VERSION lr http://$KAFKA_PROXY/topics/$KAFKA_TOPIC $c \
        > client_output.log 2>&1 &" > out.txt 2>&1 &
done

echo "PBFT Deployment Complete."

##### DISABLE BELOW AFTER DEMO #####

# SLEEP AND KILL FOR MIDTERM DEMO
echo "Sleeping for $SLEEP_DURATION seconds to allow demo to run..."
sleep $SLEEP_DURATION

# Collect output log results.
# mkdir -p outs
# for t in ${selectReplicas[@]}; do
#     scp $t:out.txt outs/$t
# done

# echo "Killing all pbft_demo_json and wandlr processes on replicas and clients..."
for server in "${REPLICAS[@]}" "${CLIENTS[@]}"; do
    # echo "Killing processes on $server"
    ssh "$server" "pkill -9 pbft_demo_json || true; pkill -9 $WANDLR_VERSION || true" || true
done

# # Verify processes have been killed
# echo "Verifying that processes have been killed..."
# for server in "${REPLICAS[@]}" "${CLIENTS[@]}"; do
#     echo "=== Checking $server ==="
#     ssh "$server" "ps aux | grep -E 'pbft_demo_json|$WANDLR_VERSION' | grep -v grep || echo 'No matching processes found.'" || true
# done


