# consumer_api.py
#
# Minimal “Consumer API”:
# - connects to Redpanda as a Kafka consumer
# - reads from topic pbft-logs
# - filters for PBFT protocol messages
# - streams them to the browser via Server-Sent Events (SSE)

import json
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
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
    "reply": "Reply",
}

_last_eid_assigned = 0

app = FastAPI(title="PBFT Consumer API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def make_consumer(offset: str = "latest", group_id: str | None = None) -> KafkaConsumer:
    """
    Create a Kafka consumer subscribed to the PBFT log topic.
    offset: "latest" -> only new messages
            "earliest" -> replay from beginning
    """
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


def filter_pbft_event(raw_value: str) -> Dict[str, Any] | None:
    """
    Take the raw JSON string from Kafka and:
    - parse it
    - drop non-PBFT-noise logs
    - return a small cleaned dict for the UI, or None to skip
    """
    try:
        obj = json.loads(raw_value)
    except json.JSONDecodeError:
        return None

    if not isinstance(obj, dict):
        return None

    # We only care about protocol-level messages
    if obj.get("log-name") != "log_message_event":
        return None

    data = obj.get("log-data")
    if not isinstance(data, dict):
        return None

    message_name = data.get("message-name")
    # For now, keep ALL protocol messages; React can decide what to show
    # If you want to narrow it:
    # core = {"request","preprepare","prepare","commit","reply","decide","decision","decided"}
    # if message_name not in core: return None

    # Extract some useful fields
    conn = data.get("connection") or {}
    participant = conn.get("participant")

    cleaned = {
        "log_name": obj.get("log-name"),
        "instance": data.get("instance"),
        "message_name": message_name,
        "view": data.get("view"),
        "seq": data.get("seq") or data.get("order"),
        "participant": participant,
        "timestamp": obj.get("log-timestamp") or obj.get("timestamp"),
        "raw": data,  # keep full log-data for debugging if needed
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
    if event_type == "PrePrepare":
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
        "eid": 0,  # filled later
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
    """Simple health check."""
    return {"status": "ok"}


@app.get("/stream")
def stream(offset: str = "latest", from_eid: int | None = None, group: str | None = None):
    """
    SSE endpoint.
    - React will open an EventSource to this URL.
    - We create a Kafka consumer and stream filtered PBFT events as they arrive.
    """
    consumer = make_consumer(offset=offset, group_id=group)

    control_events = [
        build_control_event("SessionStart", {"n": REPLICA_COUNT, "f": FAULT_TOLERANCE}),
        build_control_event("PrimaryElected", {"primary": 0}),
    ]

    def event_generator():
        try:
            for control in control_events:
                yield stamp_and_format_event(control)

            for msg in consumer:
                raw_value = msg.value
                cleaned = filter_pbft_event(raw_value)
                if not cleaned:
                    continue
                envelope = build_envelope(cleaned)
                if not envelope:
                    continue

                yield stamp_and_format_event(envelope)
        finally:
            consumer.close()

    return StreamingResponse(event_generator(), media_type="text/event-stream")
