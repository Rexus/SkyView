#!/usr/bin/env bash
# Skaffold builds with Docker and pushes through the configured Skopeo registry login.
set -euo pipefail
cd "$(dirname "$0")/../.."

IMAGE="${IMAGE:?IMAGE is required}"
bash deployment/docker/build.sh -t "$IMAGE"

if [ "${PUSH_IMAGE:-false}" = "true" ]; then
  skopeo copy "docker-daemon:${IMAGE}" "docker://${IMAGE}"
  if [ -n "${DIGEST:-}" ]; then
    skopeo inspect "docker://${IMAGE}" | jq -r '.Digest' > "$DIGEST"
  fi
fi
