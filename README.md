# pBFT Happy-Path Demo

PBFT Visualization REACT Web App

## Run

```
# Terminal 1
cd simulator
npm i
npm start -- --n 7 --eps 60 --port 8080

# Terminal 2
cd frontend
npm i
npm run dev
# open the printed localhost URL
# click Connect (defaults to ws://localhost:8080/ws/events)
```

## API (dev test)

```
# Install deps (on central VM)
pip install fastapi uvicorn

# Set required environment
set CLIENT_SSH=user@client-host
set CLIENT_SSH_JUMP=user@jump-host   # optional
set CLIENT_CMD="/path/to/pbft_client --once"
set REDPANDA_BROKERS=localhost:9092
set REDPANDA_TOPIC=pbft.logs

# Ensure topic exists
rpk topic create pbft.logs --brokers %REDPANDA_BROKERS%

# Start API (listens on :8000)
python api/main.py

# Stream exact client output (and forward to Redpanda)
curl http://127.0.0.1:8000/client/run
```

## SSH Hello Test

- Quick connectivity test to `client-1` via the jump host.
- Sends "Hello World" to the remote and prints the echoed response.

```
# Option A: Use a private key with -i (simplest when agent isn't set up)
python scripts/ssh_hello.py \
  --target daehan@client-1 \
  --jump daehan@206.12.94.249 \
  --identity C:\\path\\to\\daehan_id \
  --message "Hello World" \
  --no-agent-forward

# Option B: Use ssh-agent (if configured)
python scripts/ssh_hello.py \
  --target daehan@client-1 \
  --jump daehan@206.12.94.249 \
  --message "Hello World"

# If you don't need a jump host, omit --jump
```

## PBFT Client Request Test

- Starts the PBFT client on `client-1`, sends a single request (default "Hello World"),
  and streams the remote stdout back locally. Adjust `--workdir` if needed.

```
python scripts/ssh_pbft_send.py \
  --target daehan@client-1 \
  --jump daehan@206.12.94.249 \
  --workdir /path/to/pbft/install \
  --command "./pbft_demo client config-pbft-client-1.txt" \
  --request "Hello World" \
  --timeout 30

# If no jump is needed, omit --jump
# Add --no-agent-forward if your environment doesn't use agent forwarding
# Remove --workdir if the command path is absolute or already correct
```

Quick echo test (verbatim client output)
- Stream client stdout back to your terminal, unchanged:
  - `curl http://127.0.0.1:8000/client/run`
  - Configure SSH target first if needed:
    - `set CLIENT_SSH=user@client-host`
    - `set CLIENT_SSH_JUMP=user@jump-host` (optional)
    - `set CLIENT_CMD="/path/to/pbft_client --once"`
  - If `CLIENT_SSH` is unset, it emits simulated lines.

## C++ Producer Wrapper

- Code: `cpp-producer/producer.cpp`
- Build: see `cpp-producer/README.md`
- Usage example:
  - `./pbft_client | ./pbft_producer localhost:9092 pbft.logs`


