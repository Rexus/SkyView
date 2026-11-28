#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
source deployment/build-metadata.sh
skyview_build_metadata
tag=${1:?release tag required}
repo=Rexus/SkyView

if [[ "$tag" != "$version" || ! "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ || ${#tag} -gt 120 ||
      "$source_state" != clean ]]; then
  printf 'The version tag must match .version in a clean checkout\n' >&2
  exit 1
fi

if [[ "$tag" == *-* ]]; then
  IFS=. read -ra identifiers <<< "${tag#*-}"
  for identifier in "${identifiers[@]}"; do
    if [[ "$identifier" =~ ^0[0-9]+$ ]]; then
      printf 'Numeric prerelease identifiers cannot have leading zeroes\n' >&2
      exit 1
    fi
  done
fi

ref=$(gh api "repos/$repo/git/ref/tags/$tag")
tag_object=$(jq -er 'select(.object.type == "tag") | .object.sha' <<< "$ref")
signed_tag=$(gh api "repos/$repo/git/tags/$tag_object")
jq -e --arg revision "$revision" --arg tag "$tag" \
  '.verification.verified and .tag == $tag and .object.type == "commit" and .object.sha == $revision' \
  <<< "$signed_tag" >/dev/null || {
    printf 'GitHub must verify the signature on the release tag for the checked-out source\n' >&2
    exit 1
}
relation=$(gh api "repos/$repo/compare/$revision...main" --jq .status)
if [[ "$relation" != identical && "$relation" != ahead ]]; then
  printf 'The tagged commit must be in the history of main\n' >&2
  exit 1
fi
printf 'Verified %s at %s on main\n' "$tag" "$revision"
