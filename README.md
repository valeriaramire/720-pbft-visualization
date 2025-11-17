# PBFT Visualization Stack on the Webserver

This repository hosts everything that runs on the webserver to visualize PBFT message flow in real time:

- **Redpanda broker** (`redpanda-broker/`): provides the Kafka-compatible log stream that stores PBFT protocol events.
- **Consumer API** (`api/`): FastAPI service that consumes PBFT logs from Redpanda and exposes them as a Server-Sent Events (SSE) stream.
- **Frontend** (`frontend/`): Vite/React application that connects to the SSE endpoint and renders replicas, phases, and message animation.
- **External PBFT demo**: launched from the remote `mcas720` machine and writes JSON events into Redpanda (`deploy_json_demo.sh`).

## Prerequisites

- Docker Engine + Docker Compose plugin for running Redpanda.
- Python 3.11+ with `venv` and `pip`.
- Node.js 18+ and npm.
- SSH access to both `webserver` and `mcas720`, plus the private key.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `redpanda-broker/docker-compose.yml` | Redpanda broker + console, ports 9092/9644/8082/8080. |
| `api/main.py` | PBFT consumer API using Kafka consumer + FastAPI. |
| `api/requirements.txt` | Python dependencies (`fastapi`, `uvicorn`, `kafka-python`). |
| `frontend/src/App.tsx` | PBFT visualization UI (defaults to `http://localhost:8002/stream`). |

## 1. Start the Redpanda broker

```bash
cd ~/redpanda-broker
sudo docker compose up -d
```

Helpful commands:

- `sudo docker compose ps` – confirm containers are healthy.
- `sudo docker compose logs -f redpanda` – tail broker logs.

To stop Redpanda later:

```bash
cd ~/redpanda-broker
sudo docker compose down
```

The compose file advertises Redpanda on `192.168.175.117`; if the server IP changes you must update `--advertise-kafka-addr` and `--advertise-pandaproxy-addr` in `docker-compose.yml`.

## 2. Run the PBFT Consumer API

```bash
cd ~/api
python3 -m venv venv          
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8002
```

Environment variables you can customize before launching:

| Variable | Default | Description |
| --- | --- | --- |
| `KAFKA_BOOTSTRAP` | `localhost:9092` | Comma-separated Redpanda brokers. |
| `PBFT_TOPIC` | `pbft-logs` | Kafka topic with PBFT JSON. |
| `PBFT_GROUP` | `pbft-visualizer` | Consumer group ID. |
| `PBFT_REPLICAS` | `4` | Replica count `n` shown in UI. |
| `PBFT_F` | `1` | Fault tolerance `f`. |
| `PBFT_SESSION_ID` | `pbft-session` | Session ID included in SSE events. |
| `PBFT_ALLOWED_ORIGINS` | `*` | CORS allowlist for the frontend. |


## 3. Run the frontend

```bash
cd ~/frontend
npm install
npm run dev        # Vite dev server (default http://localhost:5173)
```

The UI defaults to hitting `http://localhost:8002/stream`. If you tunnel the API to a different port, update the URL field in the UI before clicking **Connect**.

Stop the dev server with `Ctrl+C`.

## 4. Tunnel the API to your laptop (if developing remotely)

From your local workstation:

```bash
ssh -N -L 18080:localhost:8002 [your name]@206.12.90.91
# or, once inside the shared jump host:
ssh -N -L 18080:localhost:8002 webserver
```

Keep the SSH window open.

## 5. Launch the PBFT demo workload on `mcas720`

1. SSH into the workload machine and deploy the JSON demo:
   ```bash
   ssh mcas720
   cd ~/newtools
   ./deploy_json_demo.sh
   ```

`deploy_json_demo.sh` produces PBFT JSON logs and publishes them to the Redpanda topic consumed by `api/main.py`. Keep it running while you need live traffic.

## 6. Teardown checklist

1. Stop the Vite dev server (`Ctrl+C`).
2. Stop `uvicorn` (`Ctrl+C`) and `deactivate` the Python virtualenv.
3. Stop the PBFT demo on `mcas720` when finished.
4. Shut down Redpanda when no longer needed:
   ```bash
   cd ~/redpanda-broker
   sudo docker compose down
   ```
5. Close any SSH tunnels (`Ctrl+C` on the tunnel session).

Following the order above ensures consumers disconnect cleanly before the broker is removed, which prevents the frontend from hanging on stale SSE connections.
