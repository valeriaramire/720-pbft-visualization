#!/bin/bash

# Default replica number
replica=${1:-1}
WANDLR_VERSION="wandlr"
WEBSERVER_IP="192.168.175.117"

# Kill the replica process
echo "Killing replica-$replica"

ssh "replica-$replica" "pkill -9 pbft_demo_json || true; pkill -9 $WANDLR_VERSION || true" || true

echo "Verifying that processes have been killed on replica-$replica..."
ssh "replica-$replica" "ps aux | grep -E 'pbft_demo_json|$WANDLR_VERSION' | grep -v grep || echo 'No matching processes found on replica-$replica.'" || true

echo "Killed pbft_demo_json and wandlr processes on replica-$replica."

# Notify backend about the faulty replica so live UI can update
curl -s -X POST "http://$WEBSERVER_IP:8002/faulty_update" \
  -d "ids=$replica" \
  -d "action=add" >/dev/null || true
