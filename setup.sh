#!/usr/bin/env bash
set -euo pipefail

#######################################
# Order of Setup
# 1. Setup Redpanda Broker
# 2. Setup Consumer API
# 3. Remotely deploy PBFT replicas and clients (mcas720)
# 4. Setup React Frontend
#######################################

########## VARS ##########
DIR_REDPANDA="redpanda-broker"
DIR_CONSUMER_API="api"
DIR_REACT=""

PBFT_SETUP_SCRIPT="scripts/setup_pbft.sh"
########## END VARS ##########


echo "========== 1. Setup Redpanda Broker =========="

if [ ! -d "$DIR_REDPANDA" ]; then
    echo "Error: $DIR_REDPANDA directory not found!"
    exit 1
fi

cd "$DIR_REDPANDA"
sudo docker compose up -d
cd -

sleep 5  # wait for Redpanda to initialize
echo "Redpanda Broker setup complete."


echo "========== 2. Setup Consumer API =========="

if [ ! -d "$DIR_CONSUMER_API" ]; then
    echo "Warning: $DIR_CONSUMER_API directory not found, skipping API startup."
else
    cd "$DIR_CONSUMER_API"

    # Create venv if needed
    if [ ! -d "venv" ]; then
        echo "[API] Creating Python venv..."
        python3 -m venv venv
        echo "[API] Installing requirements..."
        ./venv/bin/pip install -r requirements.txt
    else
        echo "[API] Using existing venv..."
        ./venv/bin/pip install -r requirements.txt
    fi

     # Start uvicorn in background
    echo "[API] Starting uvicorn on 0.0.0.0:8002 (split stdout/stderr logs)..."
    mkdir -p logs
    nohup ./venv/bin/uvicorn main:app --host 0.0.0.0 --port 8002 --access-log \
        > logs/access.log \
        2> logs/error.log &

    cd -
fi

sleep 5 
echo "Consumer API setup step complete."


echo "========== 3. Setup PBFT replicas and clients =========="

if [ ! -x "$PBFT_SETUP_SCRIPT" ]; then
    echo "Error: $PBFT_SETUP_SCRIPT not found or not executable!"
    exit 1
fi

bash "$PBFT_SETUP_SCRIPT"

echo "PBFT replicas and clients deployed."


# echo "========== 4. Setup React Frontend =========="

echo "========== Setup complete =========="
