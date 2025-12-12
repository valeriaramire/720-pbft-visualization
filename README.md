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

## 1. Start the Redpanda broker, API, and remote pBFT setup.

```bash
chmod +x setup.sh
./setup.sh
```

## 2. Run the frontend

```bash
cd ~/frontend
npm install
npm run dev        # Vite dev server (default http://localhost:5173)
```

The UI defaults to hitting `http://localhost:8002/stream`. If you tunnel the API to a different port, update the URL field in the UI before clicking **Connect**.

Stop the dev server with `Ctrl+C`.

## 3. Teardown checklist

1. Stop the Vite dev server (`Ctrl+C`).
2. Use backend teardown script
   ```bash
   chmod +x teardown.sh
   ./teardown.sh
   ```
3. Close any SSH tunnels (`Ctrl+C` on the tunnel session).

