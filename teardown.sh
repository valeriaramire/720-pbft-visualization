#!/usr/bin/env bash
set -euo pipefail

#######################################
# Order of Teardown
# 1. Shutdown PBFT replicas and clients (mcas720)
# 2. Shutdown Consumer API
# 3. Shutdown Redpanda Broker
# 4. Shutdown React Frontend (optional)
#######################################

########## VARS ##########
DIR_REDPANDA="redpanda-broker"
DIR_CONSUMER_API="api"
PBFT_KILL_SCRIPT="scripts/kill_pbft.sh"
########## END VARS ##########

echo "========== 1. Shutdown PBFT (from webserver) =========="

if [ -x "$PBFT_KILL_SCRIPT" ]; then
    bash "$PBFT_KILL_SCRIPT"
else
    echo "Warning: $PBFT_KILL_SCRIPT not found or not executable; skipping PBFT kill step."
fi


echo "========== 2. Shutdown Consumer API =========="

if [ -d "$DIR_CONSUMER_API" ]; then
    cd "$DIR_CONSUMER_API"

    # Kill uvicorn serving main:app on 0.0.0.0:8002
    pkill -f "uvicorn main:app --host 0.0.0.0 --port 8002" \
      || pkill -f "uvicorn main:app" \
      || echo "Warning: uvicorn process not found."

    cd -
else
    echo "Consumer API directory $DIR_CONSUMER_API not found; skipping."
fi

echo "========== 3. Shutdown Redpanda Broker =========="

if [ -d "$DIR_REDPANDA" ]; then
    cd "$DIR_REDPANDA"
    sudo docker compose down || echo "Warning: docker compose down failed."
    cd -
    echo "Redpanda Broker shut down."
else
    echo "Redpanda directory $DIR_REDPANDA not found; skipping."
fi

# echo "========== 4. Shutdown REACT UI =========="

echo "========== Teardown complete =========="