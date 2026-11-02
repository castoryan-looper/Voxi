#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run using sudo bash deploy/bootstrap.sh';exit 1; }
for command in docker git openssl curl flock;do command -v "$command" >/dev/null || { echo "Missing $command";exit 1; };done
docker compose version >/dev/null
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
install -d -m 700 /etc/voxi
# The service follows this stable link, independent of the clone directory.
if [[ -e /etc/voxi/repo && ! -L /etc/voxi/repo ]]; then
  echo '/etc/voxi/repo exists and is not a symlink; stopping';exit 1
fi
ln -sfnT "$root" /etc/voxi/repo
# sudo/systemd operate as root even when the clone belongs to the login user.
if ! git config --global --get-all safe.directory | grep -Fxq "$root"; then
  git config --global --add safe.directory "$root"
fi
if [[ ! -f /etc/voxi/gateway.env ]]; then
  umask 077
  printf 'MODE=mock\nPORT=8787\nDEVICE_TOKEN=%s\nOPENAI_API_KEY=\nOPENAI_MODEL=gpt-realtime-2.1\nOPENAI_VOICE=marin\nMAX_CONNECTIONS=2\n' "$(openssl rand -hex 32)" > /etc/voxi/gateway.env
fi
if [[ ! -f /etc/voxi/deploy.env ]];then printf 'VOXI_HTTPS_PORT=9443\n' > /etc/voxi/deploy.env;fi
bash "$root/deploy/make-tls.sh" "${1:-43.160.215.253}"
git -C "$root" config core.hooksPath .githooks
chmod +x "$root/.githooks/post-merge"
bash "$root/deploy/deploy.sh" --no-pull
install -m 644 "$root/deploy/voxi-update.service" /etc/systemd/system/
install -m 644 "$root/deploy/voxi-update.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now voxi-update.timer
echo 'Ready: WSS port 9443. Open this TCP port in Tencent security group and host firewall.'
echo 'Device config: DEVICE_TOKEN in /etc/voxi/gateway.env; root CA in /etc/voxi/tls/ca.crt'
