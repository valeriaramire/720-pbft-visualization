#!/bin/bash

# Default replica number
replica=${1:-1}

WEBSERVER_IP="192.168.175.117"
WANDLR_URL="http://$WEBSERVER_IP:8002/castest"
KAFKA_PROXY="$WEBSERVER_IP:8082"
KAFKA_TOPIC="pbft-logs"
WANDLR_VERSION="wandlr"

# revive the replica process
echo "Reviving replica-$replica"

ssh -A $t "nohup ./pbft_demo_json replica config-pbft-$t.txt \
    | ./$WANDLR_VERSION lr http://$KAFKA_PROXY/topics/$KAFKA_TOPIC $t \
    > replica_output.log 2>&1 &" > out.txt 2>&1 &

sleep 1

echo "Revived replica-$replica."