#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
source deployment/build-metadata.sh
skyview_build_metadata
release_tag=${1:?release tag required}
bash deployment/release/verify.sh "$release_tag"
flags=$(skyview_link_flags)

npm --prefix web ci --no-audit --no-fund
npm --prefix web run build

out=bin/release
mkdir -p "$out"
for os in linux windows; do
  prefix="skyview-$version-$os-amd64"
  dir="$out/$prefix"
  mkdir -p "$dir"
  exe=skyview
  if [[ "$os" == windows ]]; then exe=skyview.exe; fi
  CGO_ENABLED=0 GOOS="$os" GOARCH=amd64 go build -buildvcs=false -trimpath -ldflags "$flags" -o "$dir/$exe" ./cmd/skyview
  cp .version LICENSE THIRD_PARTY_NOTICES.md "$dir/"
  if [[ "$os" == linux ]]; then
    "$dir/$exe" version -json > "$out/build-info.json"
    jq -e --arg tag "$version" --arg sha "$revision" \
      '.official and .tag == $tag and .revision == $sha and .sourceState == "clean"' "$out/build-info.json" >/dev/null
    tar -czf "$out/$prefix.tar.gz" -C "$out" "$prefix"
  else
    (cd "$out" && zip -qr "$prefix.zip" "$prefix")
  fi
done
(cd "$out" && sha256sum ./*.tar.gz ./*.zip build-info.json > SHA256SUMS)
