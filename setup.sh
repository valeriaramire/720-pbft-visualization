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
# Remote PBFT scripts on mcas720 (central server)
PBFT_SETUP_SCRIPT="setup_pbft.sh"
PBFT_DEPLOY_SCRIPT="deploy_pbft.sh"
PBFT_KILL_SCRIPT="kill_pbft.sh"
WANDLR_VER="wandlr_fixed"

# CENTRAL_HOST="206.12.94.249" # mcas720 server IP
CENTRAL_HOST="mcas720"

# Local project dirs on the webserver
DIR_REDPANDA="redpanda-broker"
DIR_CONSUMER_API="api"
DIR_REACT=""
DIR_PBFT_DEPLOY="newtools"      # where wandlr + pbft binaries live on mcas720
DIR_SCRIPTS="scripts"           # local folder holding setup_pbft.sh, deploy_pbft.sh, kill_pbft.sh
DIR_REMOTE_FILES="remote-files"        # local folder holding files to be copied to mcas720
########## END VARS ##########


echo "========== 1. Setup Redpanda Broker =========="

if [ ! -d "$DIR_REDPANDA" ]; then
    echo "Error: $DIR_REDPANDA directory not found!"
    exit 1
fi

cd "$DIR_REDPANDA"
sudo docker compose up -d
cd -

sleep 10  # wait for Redpanda to initialize
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
    echo "[API] Starting uvicorn on 0.0.0.0:8002..."
    nohup ./venv/bin/uvicorn main:app --host 0.0.0.0 --port 8002 \
        > api.log 2>&1 &

    cd -
fi

sleep 5 
echo "Consumer API setup step complete."


echo "========== 3. Remotely deploy PBFT (mcas720) =========="

if [ ! -d "$DIR_SCRIPTS" ]; then
    echo "Error: $DIR_SCRIPTS directory not found!"
    exit 1
fi

# # Copy PBFT scripts + wandlr binary to mcas720
# ssh "$CENTRAL_HOST" "rm -f ~/$DIR_PBFT_DEPLOY/$PBFT_DEPLOY_SCRIPT ~/$DIR_PBFT_DEPLOY/$WANDLR_VER"
# scp $DIR_SCRIPTS/$PBFT_DEPLOY_SCRIPT "$CENTRAL_HOST:~/$DIR_PBFT_DEPLOY/$PBFT_DEPLOY_SCRIPT"
# ssh "$CENTRAL_HOST" "chmod +x ~/$DIR_PBFT_DEPLOY/$PBFT_DEPLOY_SCRIPT && chmod +x ~/$DIR_PBFT_DEPLOY/$WANDLR_VER"

# Run remote setup script from its directory so relative paths (e.g., ./genconf) resolve
ssh "$CENTRAL_HOST" "cd ~/$DIR_PBFT_DEPLOY && bash $PBFT_SETUP_SCRIPT"

sleep 10 # wait for PBFT to initialize
echo "PBFT replicas and clients deployed."


# echo "========== 4. Setup React Frontend =========="

# if [ ! -d "$DIR_REACT" ]; then
#     echo "Warning: $DIR_REACT directory not found, skipping React startup."
# else
#     cd "$DIR_REACT"


    
#     cd -
# fi

echo "========== Setup complete =========="
