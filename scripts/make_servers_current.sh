#!/usr/bin/env bash
set -euo pipefail

# This script creates servers.current.data
# from servers.data by keeping only:
#   - the first N replicas
#   - all client lines
# and wrapping them in a { ... } block with no blanks.

if [ $# -lt 1 ]; then
    echo "Usage: $0 <num_replicas>"
    exit 1
fi

N="$1"

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_FILES_DIR="$BASE_DIR/remote-files"
SRC="$REMOTE_FILES_DIR/servers.data"
DST="$REMOTE_FILES_DIR/servers.current.data"

if [ ! -f "$SRC" ]; then
    echo "Error: $SRC not found"
    exit 1
fi

echo "[make_servers_current] Building $DST for $N replicas..."

replica_seen=0
: > "$DST"

# Always start with a clean opening brace
echo "{" >> "$DST"

# Iterate over all lines in servers.data, but ignore its own { } and comments
while IFS= read -r line; do
    # Trim leading/trailing whitespace
    trimmed="${line#"${line%%[![:space:]]*}"}"
    trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"

    # Skip empty lines and original braces
    if [ -z "$trimmed" ] || [ "$trimmed" = "{" ] || [ "$trimmed" = "}" ]; then
        continue
    fi

    # We only care about tuple lines that start with "("
    if [[ "$trimmed" != \(** ]]; then
        continue
    fi

    # Replica line
    if [[ "$trimmed" =~ ^\(replica- ]]; then
        replica_seen=$((replica_seen + 1))
        if [ "$replica_seen" -le "$N" ]; then
            echo "$trimmed" >> "$DST"
        else
            # Drop replicas beyond N
            continue
        fi

    # Client line
    elif [[ "$trimmed" =~ ^\(client- ]]; then
        echo "$trimmed" >> "$DST"

    else
        # Any other tuple type: keep just in case
        echo "$trimmed" >> "$DST"
    fi

done < "$SRC"

# Always end with a closing brace, no blank line in between
echo "}" >> "$DST"

echo "[make_servers_current] Done. Replicas in source: $replica_seen, kept: $N (or fewer if not enough)."
