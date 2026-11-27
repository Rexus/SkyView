#!/usr/bin/env bash
# Skaffold custom builder.
#
# Builds the image with Docker and pushes it with Skopeo. Skopeo is used for
# the push because the Docker daemon on the build host does not trust the
# internal registry's self-signed CA; Skopeo can opt out of TLS verification
# for this one registry without changing daemon configuration.
#
# Skaffold provides $IMAGE and $PUSH_IMAGE (a boolean). Set HARBOR_USER and
# HARBOR_PASSWORD when running Skaffold.
set -euo pipefail

IMAGE="${IMAGE:?IMAGE is required}"
PUSH="${PUSH_IMAGE:-false}"
HARBOR_USER="${HARBOR_USER:-}"
HARBOR_PASSWORD="${HARBOR_PASSWORD:-}"

docker build -t "$IMAGE" .

if [ "$PUSH" = "true" ]; then
  if [ -z "$HARBOR_PASSWORD" ]; then
    echo "HARBOR_PASSWORD is not set; cannot push $IMAGE" >&2
    exit 1
  fi

  COPY_ARGS=(copy --dest-tls-verify=false)
  if [ -n "$HARBOR_USER" ]; then
    COPY_ARGS+=(--dest-creds "${HARBOR_USER}:${HARBOR_PASSWORD}")
  fi
  skopeo "${COPY_ARGS[@]}" "docker-daemon:${IMAGE}" "docker://${IMAGE}"

  if [ -n "${DIGEST:-}" ]; then
    INSPECT_ARGS=(inspect --tls-verify=false)
    if [ -n "$HARBOR_USER" ]; then
      INSPECT_ARGS+=(--creds "${HARBOR_USER}:${HARBOR_PASSWORD}")
    fi
    skopeo "${INSPECT_ARGS[@]}" "docker://${IMAGE}" | jq -r '.Digest' > "$DIGEST"
  fi
fi
