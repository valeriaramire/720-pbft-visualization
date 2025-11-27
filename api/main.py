# PBFT Protocol Message Streamer
# - connects to Redpanda as a Kafka consumer
# - reads from topic pbft-logs
# - filters for PBFT protocol messages
# - streams them to the browser via Server-Sent Events (SSE)

import json
import os
import time
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, PlainTextResponse
from kafka import KafkaConsumer

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092").split(",")
KAFKA_BOOTSTRAP_SERVERS = [server.strip() for server in KAFKA_BOOTSTRAP_SERVERS if server.strip()]
if not KAFKA_BOOTSTRAP_SERVERS:
    KAFKA_BOOTSTRAP_SERVERS = ["localhost:9092"]
KAFKA_TOPIC = os.getenv("PBFT_TOPIC", "pbft-logs")
KAFKA_GROUP_ID = os.getenv("PBFT_GROUP", "pbft-visualizer")

REPLICA_COUNT = int(os.getenv("PBFT_REPLICAS", "4"))
FAULT_TOLERANCE = int(os.getenv("PBFT_F", "1"))
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

EXPECTED_EVENTS_PER_REQUEST = int(os.getenv("PBFT_EVENTS_PER_REQUEST", "29"))
REQUEST_FLUSH_AFTER_SEC = float(os.getenv("PBFT_REQUEST_FLUSH_SEC", "2.0"))
MAX_REQUEST_BUFFERS = int(os.getenv("PBFT_MAX_INFLIGHT_REQUESTS", "64"))

_last_eid_assigned = 0
current_request = "Empty Request"

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
    consumer = KafkaConsumer(
        KAFKA_TOPIC,
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        group_id=group_id or KAFKA_GROUP_ID,
        auto_offset_reset=offset,
        enable_auto_commit=True,
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

    def try_rank(obj: Dict[str, Any] | None) -> Optional[int]:
        return _first_int(obj, "rank", "counter", "req", "req_id")

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
            payload = inner_msg.get("payload") if isinstance(inner_msg, dict) else None
            r = try_rank(payload if isinstance(payload, dict) else None)
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
            return REPLICA_COUNT + max(0, val - 1)
        except ValueError:
            return None
    return None


def make_request_key(cleaned: Dict[str, Any]) -> Optional[str]:
    return None  # always let fallback grouping decide


def extract_digest(data: Dict[str, Any]) -> Optional[str]:
    if not isinstance(data, dict):
        return None
    message = data.get("message") or {}
    proposal = message.get("proposal") or {}
    proposal_msg = proposal.get("message") or {}
    digest = proposal_msg.get("digest")
    return digest if isinstance(digest, str) else None


class RequestBuffer:
    def __init__(self, expected_count: int, stale_after: float):
        self.expected_count = max(1, expected_count)
        self.stale_after = max(0.5, stale_after)
        self.events: List[Dict[str, Any]] = []
        self.meta: List[Tuple[int, Optional[int]]] = []
        self.first_seen = time.time()

    def add(self, envelope: Dict[str, Any], phase_rank: int, message_index: Optional[int]) -> None:
        self.events.append(envelope)
        self.meta.append((phase_rank, message_index if isinstance(message_index, int) else None))

    def should_flush(self, now: float) -> bool:
        if len(self.events) >= self.expected_count:
            return True
        return (now - self.first_seen) >= self.stale_after

    def drain_sorted(self) -> List[Dict[str, Any]]:
        combined = list(zip(self.meta, self.events))
        combined.sort(
            key=lambda item: (
                item[0][0],
                item[0][1] if item[0][1] is not None else 1_000_000,
                item[1].get("from", -1),
                item[1].get("ts", 0),
            )
        )
        ordered = [env for _, env in combined]
        self.events.clear()
        self.meta.clear()
        self.first_seen = time.time()
        return ordered

    def empty(self) -> bool:
        return not self.events


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
    if not isinstance(seq_val, int):
        seq_val = data.get("seq") or data.get("order")
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
    order = data.get("order")
    if isinstance(order, int):
        return order
    message = data.get("message") or {}
    proposal = message.get("proposal") or {}
    proposal_msg = proposal.get("message") or {}
    val = proposal_msg.get("order")
    if isinstance(val, int):
        return val
    return None


def extract_view(data: Dict[str, Any]) -> Optional[int]:
    view = data.get("view")
    if isinstance(view, int):
        return view
    message = data.get("message") or {}
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
    elif event_type == "PrePrepare":
        to_field = [i for i in range(REPLICA_COUNT) if i != from_id and i >= 0]

    seq_val = extract_order(cleaned.get("raw", {}))
    if not isinstance(seq_val, int):
        seq_val = cleaned.get("instance")
    if not isinstance(seq_val, int):
        seq_val = 0

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
    raw_ts = event.get("ts")
    if isinstance(raw_ts, int):
        candidate = raw_ts
    else:
        candidate = int(time.time() * 1_000_000)
    if candidate <= _last_eid_assigned:
        candidate = _last_eid_assigned + 1
    _last_eid_assigned = candidate
    event["eid"] = candidate
    payload = json.dumps(event)
    return f"id: {event['eid']}\ndata: {payload}\n\n"


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
        return [
            build_control_event("SessionStart", {"n": REPLICA_COUNT, "f": FAULT_TOLERANCE}),
            build_control_event("PrimaryElected", {"primary": 0}),
        ]

    def flush_buffer(key: str, buf: RequestBuffer):
        ordered = buf.drain_sorted()
        if not ordered:
            return
        for ctrl in control_events():
            yield stamp_and_format_event(ctrl)
        for ev in ordered:
            yield stamp_and_format_event(ev)
        buffers.pop(key, None)

    def event_generator():
        try:
            seen_assignment = False
            window_id = 0

            while True:
                polled = consumer.poll(timeout_ms=500)
                if not seen_assignment:
                    print(">> Consumer assignment:", consumer.assignment())
                    seen_assignment = True
                now = time.time()

                # flush stale buffers
                if not polled:
                    stale_keys = [k for k, b in buffers.items() if b.should_flush(now)]
                    for k in stale_keys:
                        yield from flush_buffer(k, buffers[k])
                    continue

                for records in polled.values():
                    for msg in records:
                        raw_value = msg.value
                        cleaned = filter_pbft_event(raw_value)
                        if not cleaned:
                            continue

                        envelope = build_envelope(cleaned)
                        if not envelope:
                            continue

                        event_type = envelope.get("type")
                        phase_rank = PHASE_ORDER.get(event_type)
  
                        # Use ClientRequest as the *only* request boundary
                        if event_type == "ClientRequest":
                            window_id += 1
                        req_key = f"window:{window_id}"

                        # bypass unknown types
                        if phase_rank is None:
                            yield stamp_and_format_event(envelope)
                            continue

                        # limit # of active buffers
                        if req_key not in buffers and len(buffers) >= MAX_REQUEST_BUFFERS:
                            oldest_key, oldest_buf = min(buffers.items(), key=lambda kv: kv[1].first_seen)
                            for ev in oldest_buf.drain_sorted():
                                yield stamp_and_format_event(ev)
                            buffers.pop(oldest_key, None)

                        buf = buffers.setdefault(
                            req_key,
                            RequestBuffer(EXPECTED_EVENTS_PER_REQUEST, REQUEST_FLUSH_AFTER_SEC)
                        )
                        buf.add(envelope, phase_rank, cleaned.get("message_index"))

                        if buf.should_flush(now):
                            yield from flush_buffer(req_key, buf)

                        # flush other stale buffers
                        stale_keys = [k for k, b in buffers.items() if b.should_flush(now) and k != req_key]
                        for k in stale_keys:
                            yield from flush_buffer(k, buffers[k])

                consumer.commit()

        finally:
            # flush all before close
            for k, buf in list(buffers.items()):
                yield from flush_buffer(k, buf)
            consumer.close()

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.post("/set_request")
async def set_request(message: str = Form("")):
    """
    Called by the React UI when the user hits 'Send'.
    Stores the latest request message in memory.
    """
    global current_request
    msg = message.strip()
    if not msg:
        msg = "Default PBFT request"
    current_request = msg
    return {"status": "ok"}

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