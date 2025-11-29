#!/usr/bin/env bash
set -euo pipefail


# ------ VARS -----------
WEBSERVER_IP="192.168.175.117"
WANDLR_URL="http://$WEBSERVER_IP:8002/castest"
# WANDLR_URL="https://jhellings.nl/castest.php"
KAFKA_PROXY="$WEBSERVER_IP:8082"
KAFKA_TOPIC="pbft-logs"
WANDLR_VERSION="wandlr"

CLIENTS=("client-1") # FIXED TO 1 CLIENT FOR PBFT
REPLICAS=("replica-1" "replica-2" "replica-3" "replica-4")

CLIENT_WAIT=1 # seconds between requests
CLIENT_ROUNDS="${CLIENT_ROUNDS:-1}" # number of requests in this run (default 1)
# ------------------------


# Start the replicas and the clients.
for i in ${!REPLICAS[@]}; do
    t=${REPLICAS[$i]}
    idx=$((i+1))
    ssh -A $t "nohup ./pbft_demo_json replica config-pbft-$t.txt \
        | ./$WANDLR_VERSION lr http://$KAFKA_PROXY/topics/$KAFKA_TOPIC $t \
        > replica_output.log 2>&1 &" > out.txt 2>&1 &
done

sleep 5

for i in ${!CLIENTS[@]}; do
    c=${CLIENTS[$i]}
    idx=$((i+1))
    ssh -A $c "nohup ./$WANDLR_VERSION w $WANDLR_URL $idx $CLIENT_WAIT $CLIENT_ROUNDS \
        | ./pbft_demo_json client-cert config-pbft-$c.txt \
        | ./$WANDLR_VERSION lr http://$KAFKA_PROXY/topics/$KAFKA_TOPIC $c \
        > client_output.log 2>&1 &" > out.txt 2>&1 &
done

echo "PBFT Deployment Complete."
