#!/bin/bash

# Default replica number
replica=${1:-1}

WEBSERVER_IP="192.168.175.117"
KAFKA_PROXY="$WEBSERVER_IP:8082"
KAFKA_TOPIC="pbft-logs"
WANDLR_VERSION="wandlr"

# revive the replica process
echo "Reviving replica-$replica"

ssh -A "replica-$replica" "nohup ./pbft_demo_json replica config-pbft-$replica.txt \
    | ./$WANDLR_VERSION lr http://$KAFKA_PROXY/topics/$KAFKA_TOPIC $replica \
    > replica_output.log 2>&1 &" > out.txt 2>&1 &

sleep 1

# Notify backend that the replica is healthy again
curl -s -X POST "http://$WEBSERVER_IP:8002/faulty_update" \
  -d "ids=$replica" \
  -d "action=remove" >/dev/null || true

echo "Revived replica-$replica."
