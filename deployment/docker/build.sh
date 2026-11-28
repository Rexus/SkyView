#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
source deployment/build-metadata.sh
skyview_build_metadata

release_tag=${SKYVIEW_RELEASE_TAG:-}
engine=${CONTAINER_ENGINE:-docker}
build=("$engine" build)
if [[ -n "$release_tag" ]]; then
  [[ "$source_state" == clean && "$version" == "$release_tag" ]] || {
    printf 'Release images require a clean checkout and a tag matching .version\n' >&2
    exit 1
  }
  bash deployment/release/verify.sh "$release_tag"
  build=(docker buildx build)
fi

"${build[@]}" --file deployment/docker/Dockerfile \
  --build-arg "SYSML_CHANNEL=${SYSML_CHANNEL:-published}" \
  --build-arg "SYSML_REFRESH=${SYSML_REFRESH:-$(date -u +%Y%m%dT%H%M%SZ)}" \
  --build-arg "SKYVIEW_REVISION=$revision" \
  --build-arg "SKYVIEW_SOURCE_STATE=$source_state" \
  --build-arg "SKYVIEW_SOURCE_TIME=$source_time" \
  --build-arg "SKYVIEW_RELEASE_TAG=$release_tag" \
  --label "org.opencontainers.image.version=$version" \
  --label "org.opencontainers.image.revision=$revision" \
  --label "org.opencontainers.image.source=https://github.com/Rexus/SkyView" \
  --label "org.opencontainers.image.licenses=MIT" \
  "$@" .
