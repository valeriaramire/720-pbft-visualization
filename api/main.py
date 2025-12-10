# PBFT Protocol Message Streamer
# - connects to Redpanda as a Kafka consumer
# - reads from topic pbft-logs
# - filters for PBFT protocol messages
# - streams them to the browser via Server-Sent Events (SSE)

import json
import os
import time
import subprocess
from typing import Any, Dict, List, Optional, Tuple
from collections import Counter

from fastapi import FastAPI, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, PlainTextResponse
from kafka import KafkaConsumer


def compute_fault_tolerance(replica_count: int) -> int:
    if not isinstance(replica_count, int) or replica_count < 1:
        return 0
    return max(0, (replica_count - 1) // 3)

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092").split(",")
KAFKA_BOOTSTRAP_SERVERS = [server.strip() for server in KAFKA_BOOTSTRAP_SERVERS if server.strip()]
if not KAFKA_BOOTSTRAP_SERVERS:
    KAFKA_BOOTSTRAP_SERVERS = ["localhost:9092"]
KAFKA_TOPIC = os.getenv("PBFT_TOPIC", "pbft-logs")
KAFKA_GROUP_ID = os.getenv("PBFT_GROUP", "pbft-visualizer")
MAX_POLL_INTERVAL_MS = int(os.getenv("PBFT_MAX_POLL_INTERVAL_MS", "300000"))  # 5 minutes
SESSION_TIMEOUT_MS = int(os.getenv("PBFT_SESSION_TIMEOUT_MS", "45000"))  # 45 seconds
MAX_POLL_RECORDS = int(os.getenv("PBFT_MAX_POLL_RECORDS", "136"))

REPLICA_COUNT = int(os.getenv("PBFT_REPLICAS", "4"))
_fault_from_env = os.getenv("PBFT_F")
if _fault_from_env is not None:
    try:
        FAULT_TOLERANCE = max(0, int(_fault_from_env))
        FAULT_TOLERANCE_FROM_ENV = True
    except ValueError:
        FAULT_TOLERANCE = compute_fault_tolerance(REPLICA_COUNT)
        FAULT_TOLERANCE_FROM_ENV = False
else:
    FAULT_TOLERANCE = compute_fault_tolerance(REPLICA_COUNT)
    FAULT_TOLERANCE_FROM_ENV = False
SESSION_ID = os.getenv("PBFT_SESSION_ID", "pbft-session")
ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv("PBFT_ALLOWED_ORIGINS", "*").split(",") if origin.strip()]
SCHEMA_VERSION = 1

MESSAGE_TYPE_MAP = {
    "request": "ClientRequest",
    "preprepare": "PrePrepare",
    "prepare": "Prepare",
    "commit": "Commit",
    "inform": "Reply",
}

PHASE_ORDER = {
    "ClientRequest": 0,
    "PrePrepare": 1,
    "Prepare": 2,
    "Commit": 3,
    "Reply": 4,
}

REQUEST_FLUSH_AFTER_SEC = float(os.getenv("PBFT_REQUEST_FLUSH_SEC", "12.0"))
MAX_REQUEST_BUFFERS = int(os.getenv("PBFT_MAX_INFLIGHT_REQUESTS", "64"))
# Default ON; set PBFT_DEBUG_BUFFERS=0 to disable
DEBUG_BUFFERS = os.getenv("PBFT_DEBUG_BUFFERS", "1") != "0"
DEBUG_EVENT_LOG_PATH = os.getenv("PBFT_EVENT_LOG_PATH", "./event_dump.log")

_last_eid_assigned = 0

current_request = "Empty Request"
current_request_id = 0
current_replica_count = REPLICA_COUNT
control_epoch = -1
last_round_events: List[str] = []

app = FastAPI(title="PBFT Consumer API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def make_consumer(offset: str = "latest", group_id: str | None = None) -> KafkaConsumer:
    if offset not in ("latest", "earliest"):
        offset = "latest"

    if group_id:
        group_id = group_id.strip() or None
    print(f">> Connecting to Kafka: topic={KAFKA_TOPIC}, group={group_id or KAFKA_GROUP_ID}")
    consumer = KafkaConsumer(
        KAFKA_TOPIC,
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        group_id=group_id or KAFKA_GROUP_ID,
        auto_offset_reset=offset,
        enable_auto_commit=True,
        max_poll_interval_ms=MAX_POLL_INTERVAL_MS,
        session_timeout_ms=SESSION_TIMEOUT_MS,
        max_poll_records=MAX_POLL_RECORDS,
        value_deserializer=lambda v: v.decode("utf-8", errors="ignore"),
    )
    return consumer


def _first_int(mapping: Dict[str, Any] | None, *keys: str) -> Optional[int]:
    if not isinstance(mapping, dict):
        return None
    for k in keys:
        v = mapping.get(k)
        if isinstance(v, int):
            return v
    return None


def extract_client_id(data: Dict[str, Any]) -> Optional[int]:
    if not isinstance(data, dict):
        return None

    message = data.get("message")
    proposal = message.get("proposal") if isinstance(message, dict) else None
    proposal_msg = proposal.get("message") if isinstance(proposal, dict) else None

    for candidate in (message, proposal_msg, data.get("payload")):
        cid = _first_int(candidate, "cid", "client_id", "client-id", "clientId")
        if cid is not None:
            return cid
        if isinstance(candidate, dict):
            inner_payload = candidate.get("payload")
            cid = _first_int(inner_payload, "cid", "client_id", "client-id", "clientId")
            if cid is not None:
                return cid
    return None


def extract_request_id(data: Dict[str, Any]) -> Optional[int]:
    if not isinstance(data, dict):
        return None

    message = data.get("message")
    proposal = message.get("proposal") if isinstance(message, dict) else None
    proposal_msg = proposal.get("message") if isinstance(proposal, dict) else None

    for candidate in (message, proposal_msg, data.get("payload")):
        rid = _first_int(candidate, "crid", "prid", "rid")
        if rid is not None:
            return rid
        if isinstance(candidate, dict):
            inner_payload = candidate.get("payload")
            rid = _first_int(inner_payload, "crid", "prid", "rid")
            if rid is not None:
                return rid
    return None


def extract_request_counter(data: Dict[str, Any]) -> Optional[int]:
    if not isinstance(data, dict):
        return None

    # We only care about three places:
    # 1) message.rank
    # 2) message.client_request.message.rank
    # 3) payload.rank
    def try_rank(obj: Dict[str, Any] | None) -> Optional[int]:
        return _first_int(obj, "rank")

    message = data.get("message") if isinstance(data.get("message"), dict) else None
    if message:
        r = try_rank(message)
        if r is not None:
            return r
        client_req = message.get("client_request") if isinstance(message.get("client_request"), dict) else None
        if client_req:
            inner_msg = client_req.get("message") if isinstance(client_req.get("message"), dict) else None
            r = try_rank(inner_msg)
            if r is not None:
                return r
    payload = data.get("payload")
    return try_rank(payload if isinstance(payload, dict) else None)


def extract_message_index(data: Dict[str, Any]) -> Optional[int]:
    idx = data.get("message-index")
    return idx if isinstance(idx, int) else None


def parse_receiver_id(outer: Dict[str, Any]) -> Optional[int]:
    name = outer.get("receiver")
    if not isinstance(name, str):
        return None
    if name.startswith("replica-"):
        try:
            val = int(name.split("replica-")[-1])
            return max(0, val - 1)
        except ValueError:
            return None
    if name.startswith("client-"):
        try:
            val = int(name.split("client-")[-1])
            return current_replica_count + max(0, val - 1)
        except ValueError:
            return None
    return None


def make_request_key(cleaned: Dict[str, Any]) -> Optional[str]:
    return None  # always let fallback grouping decide


def make_order_rank_key(seq_val: Any, rank_val: Any) -> Optional[str]:
    if isinstance(seq_val, int) and isinstance(rank_val, int):
        return f"order:{seq_val}-rank:{rank_val}"
    return None


def extract_digest(data: Dict[str, Any]) -> Optional[str]:
    if not isinstance(data, dict):
        return None
    message = data.get("message") or {}
    proposal = message.get("proposal") or {}
    proposal_msg = proposal.get("message") or {}
    digest = proposal_msg.get("digest")
    return digest if isinstance(digest, str) else None


class RequestBuffer:
    def __init__(self, stale_after: float):
        self.stale_after = max(0.5, stale_after)
        self.events: List[Dict[str, Any]] = []
        self.meta: List[Tuple[int, Optional[int]]] = []
        self.first_seen = time.time()
        self.last_seen = self.first_seen

    def add(self, envelope: Dict[str, Any], phase_rank: int, message_index: Optional[int]):
        self.events.append(envelope)
        self.meta.append((phase_rank, message_index))
        self.last_seen = time.time()

    def should_flush(self, now: float) -> bool:
        return now - self.first_seen >= self.stale_after

    def drain_sorted(self) -> List[Dict[str, Any]]:
        # sort by (phase rank, message index, sender id, first to-id, timestamp)
        combined = list(zip(self.meta, self.events))
        combined.sort(key=lambda item: (
            item[0][0], # phase rank
            item[0][1] if item[0][1] is not None else 1_000_000, # message index
            item[1].get("from", -1), # sender
            min(item[1].get("to") or [-1]), # first to id for stable ordering per sender
            item[1].get("ts", 0), # timestamp
        ))
        ordered = [env for _, env in combined]
        self.events.clear()
        self.meta.clear()
        self.first_seen = time.time()
        self.last_seen = self.first_seen
        return ordered


def describe_buffers(buffers: Dict[str, RequestBuffer], active_key: Optional[str]) -> str:
    """
    Build a short debug string about current buffers.
    Example: active=order:1-rank:1 keys=[order:1-rank:1(5), pending-rank:2(1)]
    """
    parts: List[str] = []
    for key, buf in buffers.items():
        parts.append(f"{key}({len(buf.events)})")
    joined = ", ".join(parts)
    return f"active={active_key} keys=[{joined}]"


def filter_pbft_event(raw_value: str) -> Dict[str, Any] | None:
    try:
        obj = json.loads(raw_value)
    except json.JSONDecodeError:
        return None

    if not isinstance(obj, dict):
        return None

    outer = obj.get("data")
    if not isinstance(outer, dict):
        return None

    if outer.get("log-name") != "log_message_event":
        return None

    data = outer.get("log-data")
    if not isinstance(data, dict):
        return None

    message_name = data.get("message-name")

    conn = data.get("connection") or {}
    participant = conn.get("participant")
    cid = extract_client_id(data)
    crid = extract_request_id(data)
    rank = extract_request_counter(data)
    message_index = extract_message_index(data)
    seq_val = extract_order(data)
    receiver_id = parse_receiver_id(obj)

    cleaned = {
        "log_name": outer.get("log-name"),
        "instance": data.get("instance"),
        "message_name": message_name,
        "view": data.get("view"),
        "seq": seq_val,
        "participant": participant,
        "timestamp": outer.get("log-timestamp") or outer.get("timestamp"),
        "cid": cid,
        "crid": crid,
        "rank": rank,
        "message_index": message_index,
        "receiver_id": receiver_id,
        "raw": data,
    }
    return cleaned


def extract_order(data: Dict[str, Any]) -> Optional[int]:
    # Order appears in two places we care about:
    # 1) log-data.message.order (e.g., inform)
    # 2) log-data.message.proposal.message.order (preprepare/prepare/commit)
    message = data.get("message") or {}
    direct_msg_order = message.get("order")
    if isinstance(direct_msg_order, int):
        return direct_msg_order
    proposal = message.get("proposal") or {}
    proposal_msg = proposal.get("message") or {}
    val = proposal_msg.get("order")
    if isinstance(val, int):
        return val
    return None


def extract_view(data: Dict[str, Any]) -> Optional[int]:
    # View appears in two places we care about:
    # 1) log-data.message.current_view (e.g., inform)
    # 2) log-data.message.proposal.message.view (preprepare/prepare/commit)
    message = data.get("message") or {}
    direct_view = message.get("current_view")
    if isinstance(direct_view, int):
        return direct_view
    proposal = message.get("proposal") or {}
    proposal_msg = proposal.get("message") or {}
    val = proposal_msg.get("view")
    if isinstance(val, int):
        return val
    return None


def build_envelope(cleaned: Dict[str, Any]) -> Dict[str, Any] | None:
    message_name = (cleaned.get("message_name") or "").lower()
    event_type = MESSAGE_TYPE_MAP.get(message_name)
    if not event_type:
        return None

    participant = cleaned.get("participant")
    from_id = participant if isinstance(participant, int) else -1

    to_field: List[int] = []
    receiver_id = cleaned.get("receiver_id")
    if isinstance(receiver_id, int):
        to_field = [receiver_id]

    # seq matches order if present, otherwise falls back to rank
    seq_val = extract_order(cleaned.get("raw", {}))
    if not isinstance(seq_val, int):
        rank_val = cleaned.get("rank")
        if isinstance(rank_val, int):
            seq_val = rank_val

    envelope = {
        "schema_ver": SCHEMA_VERSION,
        "type": event_type,
        "ts": cleaned.get("timestamp") or int(time.time() * 1_000_000),
        "sid": SESSION_ID,
        "eid": 0,
        "view": extract_view(cleaned.get("raw", {})) or 0,
        "seq": seq_val,
        "from": from_id,
        "to": to_field,
        "data": cleaned.get("raw"),
    }
    return envelope


def stamp_and_format_event(event: Dict[str, Any]) -> str:
    global _last_eid_assigned
    _last_eid_assigned += 1
    event["eid"] = _last_eid_assigned
    payload = json.dumps(event)
    return f"id: {event['eid']}\ndata: {payload}\n\n"


def _append_debug_line(line: str) -> None:
    try:
        with open(DEBUG_EVENT_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        # best-effort debug logging; ignore failures
        pass


def build_control_event(event_type: str, data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "schema_ver": SCHEMA_VERSION,
        "type": event_type,
        "ts": int(time.time() * 1_000_000),
        "sid": SESSION_ID,
        "eid": 0,
        "view": 0,
        "seq": 0,
        "from": -1,
        "to": [],
        "data": data,
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/stream")
def stream(offset: str = "latest", from_eid: int | None = None, group: str | None = None):
    if isinstance(group, str):
        sanitized_group = group.strip() or None
    else:
        sanitized_group = None
    effective_group = sanitized_group or KAFKA_GROUP_ID
    print(f"[STREAM] offset={offset}, group={effective_group}")
    consumer = make_consumer(offset=offset, group_id=effective_group)
    buffers: Dict[str, RequestBuffer] = {}

    def control_events() -> List[Dict[str, Any]]:
        effective_f = FAULT_TOLERANCE if FAULT_TOLERANCE_FROM_ENV else compute_fault_tolerance(current_replica_count)
        return [
            build_control_event("SessionStart", {"n": current_replica_count, "f": effective_f}),
            build_control_event("PrimaryElected", {"primary": 0}),
        ]

    def flush_buffer(key: str, buf: RequestBuffer, remember: bool = True, reason: str = "manual"):
        ordered = buf.drain_sorted()
        if not ordered:
            return
        counts = Counter(ev.get("type") for ev in ordered)
        phase_detail = {k: v for k, v in sorted(counts.items())}
        seqs = sorted({ev.get("seq") for ev in ordered if isinstance(ev.get("seq"), int)})
        senders = sorted({ev.get("from") for ev in ordered if isinstance(ev.get("from"), int)})
        lines: List[str] = []
        eid_values: List[int] = []
        for ev in ordered:
            line = stamp_and_format_event(ev)
            lines.append(line)
            eid_val = ev.get("eid")
            if isinstance(eid_val, int):
                eid_values.append(eid_val)
        eid_span = (min(eid_values), max(eid_values)) if eid_values else (None, None)
        print(
            f"[FLUSH] reason={reason} key={key} total={len(ordered)} phases={phase_detail} "
            f"seqs={seqs} senders={senders} eid_span={eid_span}"
        )
        for line in lines:
            _append_debug_line(line)
            yield line
        if remember:
            last_round_events.clear()
            last_round_events.extend(lines)
        buffers.pop(key, None)

    def event_generator():
        try:
            seen_assignment = False
            # For Prepare & Commit messages, we only see order. So we need to map order <-> rank.
            order_to_rank: Dict[int, int] = {}
            # For Request messages, we only see rank. So we need to map rank <-> order.
            rank_to_order: Dict[int, int] = {}
            active_final_key: Optional[str] = None
            last_order_seen: Optional[int] = None
            last_rank_seen: Optional[int] = None
            # To avoid resending control events unnecessarily.
            last_sent_epoch = -1

            # Send initial control and latest round history
            if control_epoch >= 0 and control_epoch != last_sent_epoch:
                for ctrl in control_events():
                    line = stamp_and_format_event(ctrl)
                    _append_debug_line(line)
                    yield line
                last_sent_epoch = control_epoch
            if last_round_events:
                for line in last_round_events:
                    yield line

            while True:
                # 1. Send control events if new epoch started
                if control_epoch >= 0 and control_epoch != last_sent_epoch:
                    for ctrl in control_events():
                        line = stamp_and_format_event(ctrl)
                        _append_debug_line(line)
                        yield line
                    last_sent_epoch = control_epoch
                    # Reset state for a new session/run
                    for k, buf in list(buffers.items()):
                        yield from flush_buffer(k, buf, remember=False)
                    active_final_key = None
                    order_to_rank.clear()
                    rank_to_order.clear()
                    last_order_seen = None
                    last_rank_seen = None

                # 2. Pull messages from Kafka
                polled = consumer.poll(timeout_ms=500)
                
                # Only log once we actually have a partition, to avoid the misleading empty set
                if not seen_assignment:
                    assignment = consumer.assignment()
                    if assignment:
                        print(">> Consumer assignment:", assignment)
                        seen_assignment = True

                # TODO: check out the logic here
                def merge_buffer(src_key: str, dst_key: str) -> None:
                    if src_key == dst_key:
                        return
                    # (1. pull src buffer
                    src_buf = buffers.pop(src_key, None)
                    if not src_buf:
                        return
                    dst_buf = buffers.setdefault(dst_key, src_buf)
                    # (2. merge src into dst
                    if dst_buf is not src_buf:
                        dst_buf.events.extend(src_buf.events)
                        dst_buf.meta.extend(src_buf.meta)
                        dst_buf.first_seen = min(dst_buf.first_seen, src_buf.first_seen)
                        dst_buf.last_seen = max(dst_buf.last_seen, src_buf.last_seen)

                # 3. Process each message
                for records in polled.values():
                    for msg in records:
                        raw_value = msg.value
                        cleaned = filter_pbft_event(raw_value) # filter & clean
                        if not cleaned:
                            continue

                        envelope = build_envelope(cleaned) # build envelope
                        if not envelope:
                            continue

                        event_type = envelope.get("type") #'ClientRequest' / 'PrePrepare' / 'Prepare' / 'Commit' / 'Reply'
                        phase_rank = PHASE_ORDER.get(event_type) # 0..4

                        order_val = cleaned.get("seq")
                        rank_val = cleaned.get("rank")
                        req_key: Optional[str] = None

                        # Detect round change: any change in rank/order closes previous final buffer.
                        order_changed = isinstance(order_val, int) and last_order_seen is not None and order_val != last_order_seen
                        rank_changed = isinstance(rank_val, int) and last_rank_seen is not None and rank_val != last_rank_seen

                        should_flush = False
                        if event_type == "ClientRequest" and rank_changed:
                            should_flush = True
                        elif event_type in ("PrePrepare", "Reply") and (order_changed or rank_changed):
                            should_flush = True
                        elif event_type in ("Prepare", "Commit") and order_changed:
                            should_flush = True

                        if should_flush:
                            if active_final_key and active_final_key in buffers:
                                yield from flush_buffer(active_final_key, buffers[active_final_key], reason="boundary")
                            active_final_key = None
                            order_to_rank.clear()
                            rank_to_order.clear()
                            last_order_seen = None
                            last_rank_seen = None

                        if event_type == "ClientRequest":
                            if isinstance(rank_val, int):
                                if rank_val in rank_to_order:
                                    o = rank_to_order[rank_val]
                                    req_key = make_order_rank_key(o, rank_val)
                                    merge_buffer(f"pending-rank:{rank_val}", req_key)
                                else:
                                    req_key = f"pending-rank:{rank_val}"

                        elif event_type in ("Prepare", "Commit"):
                            if isinstance(order_val, int):
                                if order_val in order_to_rank:
                                    r = order_to_rank[order_val]
                                    req_key = make_order_rank_key(order_val, r)
                                    merge_buffer(f"pending-order:{order_val}", req_key)
                                else:
                                    req_key = f"pending-order:{order_val}"

                        elif event_type in ("PrePrepare", "Reply"):
                            if isinstance(order_val, int) and isinstance(rank_val, int):
                                order_to_rank[order_val] = rank_val
                                rank_to_order[rank_val] = order_val

                                req_key = make_order_rank_key(order_val, rank_val)

                                merge_buffer(f"pending-rank:{rank_val}", req_key)
                                merge_buffer(f"pending-order:{order_val}", req_key)
                            else:
                                req_key = active_final_key

                        if not req_key:
                            print(f"[WARN] Unroutable event, no order/rank: {event_type} raw={cleaned.get('raw')}")
                            continue

                        is_final_key = req_key.startswith("order:") if isinstance(req_key, str) else False
                        if is_final_key and active_final_key and active_final_key != req_key and active_final_key in buffers:
                            yield from flush_buffer(active_final_key, buffers[active_final_key], reason="final_key_switch")
                        if is_final_key:
                            active_final_key = req_key

                        # bypass unknown types
                        if phase_rank is None:
                            line = stamp_and_format_event(envelope)
                            _append_debug_line(line)
                            yield line
                            continue

                        # limit # of active buffers
                        if req_key not in buffers and len(buffers) >= MAX_REQUEST_BUFFERS:
                            oldest_key, oldest_buf = min(buffers.items(), key=lambda kv: kv[1].first_seen)
                            yield from flush_buffer(oldest_key, oldest_buf, reason="evict_oldest")

                        buf = buffers.setdefault(
                            req_key,
                            RequestBuffer(REQUEST_FLUSH_AFTER_SEC)
                        )
                        buf.add(envelope, phase_rank, cleaned.get("message_index"))
                        if DEBUG_BUFFERS:
                            print("[BUFFERS]", describe_buffers(buffers, active_final_key))

                        # Track last seen order/rank for round boundary detection
                        if isinstance(order_val, int):
                            last_order_seen = order_val
                        if isinstance(rank_val, int):
                            last_rank_seen = rank_val

                # Flush stale buffers to ensure single-round outputs still emit
                now_ts = time.time()
                for key, buf in list(buffers.items()):
                    if buf.should_flush(now_ts):
                        if active_final_key == key:
                            active_final_key = None
                        yield from flush_buffer(key, buf, reason="idle_timeout")

        finally:
            # flush all before close
            for k, buf in list(buffers.items()):
                yield from flush_buffer(k, buf)
            consumer.close()

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.post("/castest")
async def castest(
    client_id: str = Form(""),
    next_rank: str = Form(""),
):
    """
    Replacement for the old castest.php endpoint.
    Wandlr workload mode will POST here with client_id and next_rank.
    """
    return PlainTextResponse(current_request)

@app.post("/start_run")
async def start_run(
    message: str = Form("Default Request"),
    rounds: int = Form(1)
):
    """
    One user decision:
    - set the message that PBFT should use
    - configure how many rounds (requests) to send
    - kill any existing PBFT processes
    - start a fresh run 
    """
    global current_request, current_replica_count, control_epoch

    # 1) Normalize and store the message
    msg = message.strip()
    if not msg:
        msg = "Default Request"
    current_request = msg

    # 2) Sanitize rounds
    try:
        r = int(rounds)
    except ValueError:
        r = 1
    if r < 1:
        r = 1

    # 3) Sync replica count with any /num_replicas changes and reset control state
    current_replica_count = REPLICA_COUNT
    control_epoch = (control_epoch + 1) if control_epoch >= 0 else 0
    last_round_events.clear()

    # 4) Kill any existing PBFT processes
    subprocess.run(["bash", "../scripts/kill_pbft.sh"], check=False)

    # 4) Start a new PBFT run with CLIENT_ROUNDS set
    env = os.environ.copy()
    env["CLIENT_ROUNDS"] = str(r)

    subprocess.Popen(["bash", "../scripts/deploy_pbft.sh"], env=env)

    return {
        "status": "started",
        "rounds": r,
        "message": current_request,
        "num_replicas": current_replica_count,
    }

@app.post("/reset_run")
async def reset_run():
    """
    Kill any existing PBFT processes without starting a new run.
    """
    global current_request

    # Kill any existing PBFT processes
    subprocess.run(["bash", "../scripts/kill_pbft.sh"], check=False)

    current_request = "Empty Request"

    return {"status": "reset", "message": current_request}

@app.post("/num_replicas")
async def set_num_replicas(num_replicas: int = Form(4)):
    """
    Manage the number of PBFT replicas independently of start_run.
    """
    global REPLICA_COUNT, current_replica_count, control_epoch, last_round_events

    # Sanitize input
    try:
        new_count = int(num_replicas)
    except ValueError:
        new_count = 4
    if new_count < 2: # min is 2
        new_count = 2
    if new_count > 10: # max is 10
        new_count = 10

    # If nothing changed, don't do a full reset
    if new_count == REPLICA_COUNT:
        return {"status": "unchanged", "num_replicas": REPLICA_COUNT}

    # Kill any existing PBFT processes
    subprocess.run(["bash", "../scripts/kill_pbft.sh"], check=False)
    
    REPLICA_COUNT = new_count
    current_replica_count = new_count
    control_epoch = (control_epoch + 1) if control_epoch >= 0 else 0
    last_round_events.clear()

    # Trigger PBFT reconfiguration (kill + regen configs + recopy)
    try:
        subprocess.run(
            ["bash", "../scripts/reconfigure_pbft.sh", str(new_count)],
            check=False,
        )
        status = "updated"
    except Exception as e:
        # We still return the new replica count, but indicate an error
        status = f"error: {e!r}"

    return {"status": status, "num_replicas": REPLICA_COUNT}
