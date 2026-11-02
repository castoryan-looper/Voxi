#!/usr/bin/env bash
set -Eeuo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
mkdir -p .deploy
exec 9>.deploy/deploy.lock
flock -w 300 9
if [[ "${1:-}" != --no-pull ]]; then
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo 'Tracked files modified; stopping'; exit 1; }
  [[ "$(git branch --show-current)" == main ]] || { echo 'Expected main branch'; exit 1; }
  git -c core.hooksPath=/dev/null pull --ff-only origin main
fi
tag=$(git rev-parse HEAD)
previous=$(cat .deploy/active-tag 2>/dev/null || true)
export VOXI_IMAGE_TAG="$tag"
compose=(docker compose --env-file /etc/voxi/deploy.env -f "$root/compose.yaml")
if [[ "$tag" == "$previous" && "${1:-}" != --force ]]; then
  if curl -fsS http://127.0.0.1:8787/healthz >/dev/null; then
    echo "Already running $tag"; exit 0
  fi
fi
docker build --build-arg "REVISION=$tag" -t "voxi-gateway:$tag" .
candidate="voxi-check-$$"
cleanup(){ docker rm -f "$candidate" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$candidate" --env-file /etc/voxi/gateway.env --network none "voxi-gateway:$tag" >/dev/null
ok=false
for attempt in {1..15}; do
  if docker exec "$candidate" node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then ok=true;break;fi
  sleep 1
done
[[ "$ok" == true ]] || { echo 'Candidate failed: existing version kept'; exit 1; }
cleanup
if "${compose[@]}" up -d --force-recreate --wait --wait-timeout 60; then
  printf '%s\n' "$tag" > .deploy/active-tag
  echo "Deployed $tag"
else
  echo 'Deploy failed; attempting gateway image rollback'
  if [[ -n "$previous" ]]; then
    export VOXI_IMAGE_TAG="$previous"
    "${compose[@]}" up -d --wait --wait-timeout 60 gateway
  fi
  exit 1
fi
