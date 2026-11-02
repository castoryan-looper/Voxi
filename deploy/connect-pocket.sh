#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo bash deploy/connect-pocket.sh';exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
container=${1:-codex-pocket-gateway-1}
[[ -f /etc/voxi/gateway.env ]] || { echo 'Run Voxi bootstrap first';exit 1; }
docker network inspect codex-pocket-radio >/dev/null 2>&1 || { echo 'Upgrade/redeploy codex-pocket-cloud first; shared radio network is missing';exit 1; }
docker exec --user 10001:10001 "$container" codex --version
docker exec --user 10001:10001 "$container" python -c \
 'import aiortc;from pathlib import Path;assert Path("/app/bridge/voxi.py").is_file(),"Upgrade Pocket gateway first"'
# Only a per-device bearer is read, never CODEX_HOME/account login material.
# Pipe to stdin so the bearer is not printed or placed in process arguments.
docker exec --user 10001:10001 "$container" python -c \
 'import os,json;from pathlib import Path;p=Path(os.environ["POCKET_STATE_DIR"])/"settings.json";print(json.loads(p.read_text())["device_token"])' \
| python3 "$root/deploy/pocket-env.py"
touch /etc/voxi/pocket.enabled
bash "$root/deploy/deploy.sh" --force
