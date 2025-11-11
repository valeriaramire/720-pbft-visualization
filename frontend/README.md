# PBFT Frontend

Interactive visualization for the PBFT simulator. Built with React + Vite and tailored for streaming NDJSON events from the backend.

## Quick Start

```bash
cd frontend
npm install
npm run dev    # starts Vite dev server
npm run build  # type-check + production bundle
```

The UI defaults to `ws://localhost:8080/ws/events`. Update the URL field in the top bar if your backend runs elsewhere.

## Architecture

- **`src/App.tsx`** – houses top-level state (useReducer), demo controls, and wires all components/hooks together.
- **`src/state.ts`** – initial state + reducer logic for PBFT stages/messages.
- **`src/types.ts`** – shared type definitions for envelopes, pulses, layout modes, etc.
- **`src/hooks/`**
  - `useNDJSONSocket.ts` – WebSocket connector that parses NDJSON lines and reconnects with backoff.
  - `useCanvasRenderer.ts` – all canvas drawing for ring/lanes layouts (exporting lane layout constants).
- **`src/components/`**
  - `TopBar.tsx` – controls for connectivity, demo pacing, node counts, layout toggle.
  - `Sidebar.tsx` – quick stats (n, f, seq, quorum).
  - `CanvasPanel.tsx` – canvas wrapper with stage HUD and quorum meter.
- **`src/styles.css`** – layout & theme styling.

## Demo Mode & Faulty Nodes

Use the **Start Demo/Stop Demo/Next Step** controls to simulate PBFT phases locally. Specify faulty nodes via comma-separated replica IDs (e.g., `2,5`). Faulty replicas skip Prepare/Commit/Reply pulses so the visualization highlights abnormal behavior.

## Event Stream Format

The frontend expects NDJSON envelopes with the fields defined in `src/types.ts` (`Envelope`). Each line should be JSON-encoded and terminated with `\n`. When reconnecting, the client resumes from the last seen `eid` by appending `?from_eid=<last+1>` to the WebSocket URL.

## Troubleshooting

- **`Permission denied` running Vite** – ensure `node_modules/.bin/*` scripts are executable (`chmod +x frontend/node_modules/.bin/*`).
- **Missing optional native deps (`@rollup/...`)** – delete `node_modules` + `package-lock.json`, then reinstall (`npm install`).
- **Nothing on canvas** – confirm the backend is streaming events or run the built-in demo.

Feel free to extend components or hooks; the current layout is organized so visual tweaks live in `useCanvasRenderer` and UI changes live in `src/components`.
