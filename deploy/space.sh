#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
case "${1:-}" in
  '')
    echo '=== Host filesystems ==='
    df -h "$root"
    docker_root=$(docker info --format '{{.DockerRootDir}}')
    df -h "$docker_root"
    echo '=== Docker disk usage ==='
    docker system df
    echo '=== Containers (including stopped; no removal) ==='
    docker ps -a --size --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Size}}\t{{.Ports}}'
    echo '=== Images ==='
    docker image ls --format 'table {{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}'
    echo '=== Named volumes (no removal) ==='
    docker volume ls
    ;;
  --clean-voxi)
    # Never delete anything until an active release has been recorded.
    active=$(cat "$root/.deploy/active-tag" 2>/dev/null || true)
    previous=$(cat "$root/.deploy/previous-tag" 2>/dev/null || true)
    if [[ ! "$active" =~ ^[0-9a-f]{40}$ ]];then
      echo 'No recorded active Voxi release; keeping all tagged images';exit 0
    fi
    # Match this repository and SHA tags only; keep images referenced by ANY
    # container (including stopped containers) even if the tags look obsolete.
    refs=$(docker image ls --filter 'reference=voxi-gateway:*' --format '{{.Repository}}:{{.Tag}}')
    while IFS= read -r ref;do
      [[ "$ref" =~ ^voxi-gateway:([0-9a-f]{40})$ ]] || continue
      sha=${BASH_REMATCH[1]}
      [[ "$sha" == "$active" || "$sha" == "$previous" || "$sha" == "${VOXI_IMAGE_TAG:-}" ]] && continue
      image_id=$(docker image inspect --format '{{.Id}}' "$ref")
      in_use=$(docker ps -aq --filter "ancestor=$image_id")
      if [[ -n "$in_use" ]];then echo "Keeping container-referenced $ref";continue;fi
      docker image rm "$ref" || echo "Keeping $ref (Docker refused removal)"
    done <<< "$refs"
    # Only dangling images labelled as this project; never prune volumes,
    # containers, foreign images or the global builder cache automatically.
    docker image prune -f --filter 'label=io.voxi.project=voxi'
    ;;
  *) echo 'Usage: bash deploy/space.sh [--clean-voxi]';exit 2 ;;
esac
