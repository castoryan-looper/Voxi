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
healthy(){
  "${compose[@]}" exec -T gateway node -e \
    "fetch('http://127.0.0.1:8787/healthz').then(async r=>{const h=await r.json();if(!r.ok||h.revision!==process.argv[1])process.exit(1)}).catch(()=>process.exit(1))" "$tag" >/dev/null 2>&1
}
if [[ "$tag" == "$previous" && "${1:-}" != --force ]]; then
  if healthy; then
    echo "Already running $tag"; exit 0
  fi
fi
# Free only this project's obsolete image tags before downloading/building.
bash "$root/deploy/space.sh" --clean-voxi
docker_root=$(docker info --format '{{.DockerRootDir}}')
available_kb=$(df -Pk "$docker_root" | awk 'END {print $4}')
min_mb=${VOXI_MIN_FREE_MB:-512}
[[ "$min_mb" =~ ^[0-9]+$ ]] || { echo 'VOXI_MIN_FREE_MB must be an integer';exit 1; }
if (( available_kb < min_mb * 1024 )); then
  echo "Docker filesystem has $((available_kb / 1024)) MiB free; need at least $min_mb MiB. Run bash deploy/space.sh and inspect old resources."
  exit 1
fi
if ! docker image inspect "voxi-gateway:$tag" >/dev/null 2>&1; then
  docker build --force-rm --build-arg "REVISION=$tag" -t "voxi-gateway:$tag" .
else
  echo "Reusing voxi-gateway:$tag"
fi
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
  if [[ -n "$previous" && "$previous" != "$tag" ]]; then
    printf '%s\n' "$previous" > .deploy/previous-tag
  fi
  printf '%s\n' "$tag" > .deploy/active-tag
  bash "$root/deploy/space.sh" --clean-voxi || echo 'Image cleanup deferred'
  echo "Deployed $tag"
else
  echo 'Deploy failed; attempting gateway image rollback'
  if [[ -n "$previous" ]]; then
    export VOXI_IMAGE_TAG="$previous"
    "${compose[@]}" up -d --wait --wait-timeout 60 gateway
  fi
  exit 1
fi
