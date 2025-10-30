# pBFT Happy-Path Demo

This demo includes a Node.js WebSocket simulator that emits NDJSON events for a repeated pBFT happy-path (PrePrepare → Prepare → Commit) and a React + TypeScript frontend that visualizes the nodes, message pulses, and a quorum meter.

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

