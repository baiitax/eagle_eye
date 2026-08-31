#!/bin/bash
# restart.sh — clean restart of the NDC server with a fresh simulation state
cd "$(dirname "$0")/.."
PID=$(ss -tlnp 2>/dev/null | grep ':3000 ' | grep -oP 'pid=\K[0-9]+' | head -1)
if [ -n "$PID" ]; then kill -9 "$PID" 2>/dev/null; sleep 1; fi
rm -f data/state.json
echo "stopped $PID, state wiped"
