/*
 pBFT Happy-Path NDJSON WebSocket Simulator

 - Emits a repeating sequence of PrePrepare → Prepare → Commit events
 - Supports multiple concurrent WS clients
 - Rolling in-memory log; clients can request replay via ?from_eid=K
 - CLI flags: --n <replicas>, --eps <events/sec>, --port <port>
*/

const http = require('http');
const url = require('url');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

// Simple CLI args parser
function parseArgs(argv) {
  const out = { n: 7, eps: 60, port: 8080 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--n') out.n = parseInt(argv[++i] || '7', 10);
    else if (a === '--eps') out.eps = parseFloat(argv[++i] || '60');
    else if (a === '--port') out.port = parseInt(argv[++i] || '8080', 10);
  }
  return out;
}

const { n, eps, port } = parseArgs(process.argv.slice(2));
const f = Math.floor((n - 1) / 3);

const primary = 0;
const view = 0;

// Session identifiers and clocks
const sid = `run-${Date.now()}`;
const startHr = process.hrtime.bigint();
let eid = 0;

function nowMicros() {
  const delta = process.hrtime.bigint() - startHr; // in nanoseconds
  return Number(delta / 1000n); // microseconds
}

// Rolling log (store last N events)
const LOG_LIMIT = 10000;
const log = []; // { eid, line }

function appendLog(eidValue, line) {
  log.push({ eid: eidValue, line });
  if (log.length > LOG_LIMIT) log.shift();
}

// Broadcast to all clients
const clients = new Set();

function broadcast(line) {
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(line);
    }
  }
}

function emitEvent(evt) {
  evt.schema_ver = 1;
  evt.ts = nowMicros();
  evt.sid = sid;
  evt.eid = ++eid;
  evt.view = view;
  if (!('data' in evt)) evt.data = {};
  const line = JSON.stringify(evt);
  appendLog(evt.eid, line);
  broadcast(line);
}

// Emit SessionStart and PrimaryElected at boot
function emitSessionStart() {
  emitEvent({ type: 'SessionStart', seq: 0, from: -1, to: [], data: { n, f } });
  emitEvent({ type: 'PrimaryElected', seq: 0, from: -1, to: [], data: { primary } });
}

// Deterministic digest per seq
function digestForSeq(seq) {
  const h = crypto.createHash('sha256');
  h.update(`view:${view};seq:${seq};primary:${primary};n:${n}`);
  return h.digest('hex');
}

// Generator producing events for PrePrepare → Prepare → Commit cycles
function* eventStream() {
  let seq = 1;
  while (true) {
    // PrePrepare from primary → others
    yield {
      type: 'PrePrepare',
      seq,
      from: primary,
      to: Array.from({ length: n - 1 }, (_, i) => i + 1),
      data: { digest: digestForSeq(seq) }
    };

    // Prepare from all replicas (including primary)
    for (let r = 0; r < n; r++) {
      yield {
        type: 'Prepare',
        seq,
        from: r,
        to: [],
        data: {}
      };
    }

    // Commit from all replicas (including primary)
    for (let r = 0; r < n; r++) {
      yield {
        type: 'Commit',
        seq,
        from: r,
        to: [],
        data: {}
      };
    }

    seq += 1;
  }
}

// HTTP server for upgrade handling
const server = http.createServer((req, res) => {
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', function upgrade(request, socket, head) {
  const { pathname } = url.parse(request.url);
  if (pathname === '/ws/events') {
    wss.handleUpgrade(request, socket, head, function done(ws) {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  clients.add(ws);

  // Parse from_eid for replay
  const parsed = url.parse(req.url, true);
  const fromEidStr = (parsed && parsed.query && parsed.query.from_eid) || null;
  let fromEid = null;
  if (fromEidStr !== null && fromEidStr !== undefined) {
    const v = parseInt(String(fromEidStr), 10);
    if (!Number.isNaN(v)) fromEid = v;
  }

  // If from_eid provided, replay matching events
  if (fromEid !== null) {
    for (const item of log) {
      if (item.eid >= fromEid) {
        try { ws.send(item.line); } catch {}
      }
    }
  }

  ws.on('close', () => {
    clients.delete(ws);
  });
});

server.listen(port, () => {
  console.log(`Simulator listening on ws://localhost:${port}/ws/events`);
});

// Start emitting
emitSessionStart();
const gen = eventStream();

const intervalMs = Math.max(1, Math.floor(1000 / Math.max(1, eps)));
setInterval(() => {
  const evt = gen.next().value;
  if (evt) emitEvent(evt);
}, intervalMs);

