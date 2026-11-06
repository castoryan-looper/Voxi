#!/usr/bin/env bash
# Run on the Docker host during a real reply; captures counters, not payloads.
set -euo pipefail
samples=${1:-90}
interval=${2:-2}
[[ "$samples" =~ ^[0-9]+$ && "$interval" =~ ^[0-9]+$ ]] || { echo 'Usage: capture-cellular-tcp.sh [samples 1..300] [interval 1..30]' >&2; exit 2; }
(( samples>=1 && samples<=300 && interval>=1 && interval<=30 )) || exit 2
for tool in docker nsenter ss date; do
    command -v "$tool" >/dev/null || { echo "Required host tool missing: $tool" >&2; exit 1; }
done
for ((i=0;i<samples;i++)); do
    pid=$(docker inspect --format '{{.State.Pid}}' voxi-proxy-1)
    [[ "$pid" =~ ^[0-9]+$ ]] && ((pid>0)) || { echo 'Voxi proxy is not running' >&2; exit 1; }
    date -u '+%Y-%m-%dT%H:%M:%SZ'
    # Inspect the public TLS socket, not Node's internal proxy connection.
    nsenter -t "$pid" -n ss -tin state established '( sport = :443 )'
    if ((i+1<samples)); then sleep "$interval"; fi
done
