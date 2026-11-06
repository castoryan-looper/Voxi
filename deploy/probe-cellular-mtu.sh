#!/usr/bin/env bash
# Temporary IPv4 route-MTU experiment in the proxy's network namespace.
# Not a production fix. Does not alter host defaults, TLS or firmware.
set -euo pipefail
peer=${1:-}
duration=${2:-180}
mtu=${3:-900}
[[ "$peer" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo 'Usage: probe-cellular-mtu.sh PEER_IPV4 [seconds 30..300] [mtu 600..1400]' >&2; exit 2; }
IFS=. read -r -a octets <<< "$peer"
for octet in "${octets[@]}"; do ((10#$octet<=255)) || exit 2; done
[[ "$duration" =~ ^[0-9]+$ && "$mtu" =~ ^[0-9]+$ ]] || exit 2
((duration>=30 && duration<=300 && mtu>=600 && mtu<=1400)) || exit 2
for tool in docker nsenter ip ss readlink date; do command -v "$tool" >/dev/null || { echo "Missing: $tool" >&2; exit 1; }; done
pid=$(docker inspect --format '{{.State.Pid}}' voxi-proxy-1)
[[ "$pid" =~ ^[0-9]+$ ]] && ((pid>0)) || exit 1
netns=$(readlink "/proc/$pid/ns/net")
nrun(){ nsenter -t "$pid" -n "$@"; }
[[ -z "$(nrun ip -4 route show exact "$peer/32")" ]] || { echo 'An explicit route already exists; refusing to replace it' >&2; exit 1; }
read -r -a route <<< "$(nrun ip -o -4 route get "$peer")"
gateway=''
device=''
for ((i=0;i+1<${#route[@]};i++)); do
    case "${route[i]}" in via) gateway=${route[i+1]};; dev) device=${route[i+1]};; esac
done
[[ -n "$device" && "$device" != lo ]] || { echo 'No external route found' >&2; exit 1; }
args=("$peer/32")
[[ -z "$gateway" ]] || args+=(via "$gateway")
args+=(dev "$device" proto 186)
added=false
cleanup(){
    if "$added" && [[ "$(readlink "/proc/$pid/ns/net" 2>/dev/null || true)" == "$netns" ]]; then
        if nrun ip -4 route del "${args[@]}"; then echo 'Temporary MTU route removed';
        else echo 'Cleanup failed: inspect the peer /32 route marked proto 186' >&2; fi
    fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
nrun ip -4 route add "${args[@]}" mtu "$mtu"
added=true
echo "Temporary route MTU=$mtu for peer=$peer, duration=$duration seconds"
echo 'A hypothesis test only. Confirm a smaller mss/pmtu in ss before attributing any change.'
nrun ip -4 route get "$peer"
end=$((SECONDS+duration))
while ((SECONDS<end)); do
    [[ "$(readlink "/proc/$pid/ns/net" 2>/dev/null || true)" == "$netns" ]] || { echo 'Proxy namespace changed; stopping' >&2; exit 1; }
    date -u '+%Y-%m-%dT%H:%M:%SZ'
    nrun ss -tin state established '( sport = :443 )'
    sleep 2
done
