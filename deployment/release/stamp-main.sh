#!/usr/bin/env bash
set -euo pipefail

pr=${1:?Pull request number required}
merged=${2:?Merge commit required}
intent=${3:?Release version or bump required}
[[ "$pr" =~ ^[1-9][0-9]*$ && "$merged" =~ ^[0-9a-f]{40}$ ]]
[[ -z "$(git status --porcelain)" ]] || { echo 'A clean checkout is required' >&2; exit 1; }

marker="SkyView-Release-PR: $pr"
merge_marker="SkyView-Release-Merge: $merged"
fingerprint=${SKYVIEW_RELEASE_FINGERPRINT:?Release signing fingerprint required}

index_dir=$(mktemp -d)
trap 'rm -rf "$index_dir"' EXIT

publish_tag() {
  local tag=$1 commit=$2 refs
  refs=$(git ls-remote origin "refs/tags/$tag" "refs/tags/$tag^{}")
  if [[ -n "$refs" ]]; then
    if grep -Fxq "$commit"$'\t'"refs/tags/$tag^{}" <<< "$refs"; then
      printf '%s already tagged at %s\n' "$tag" "$commit"
      return
    fi
    echo "Existing tag $tag points to a different object" >&2
    return 1
  fi
  if git show-ref --verify --quiet "refs/tags/$tag"; then
    [[ "$(git rev-parse "refs/tags/$tag^{commit}")" == "$commit" ]]
    git verify-tag "$tag"
  else
    git -c gpg.format=openpgp tag -u "$fingerprint" -m "SkyView $tag" "$tag" "$commit"
  fi
  git push origin "refs/tags/$tag"
}

for attempt in 1 2 3 4; do
  git fetch --quiet --no-tags origin refs/heads/main:refs/remotes/origin/main
  head=$(git rev-parse refs/remotes/origin/main)
  git merge-base --is-ancestor "$merged" "$head" || {
    echo 'The pull request merge commit must be in main' >&2
    exit 1
  }
  # The signed stamp is our recovery record if tag creation failed after the commit push.
  while IFS= read -r commit; do
    message=$(git show -s --format=%B "$commit")
    if grep -Fxq "$merge_marker" <<< "$message"; then
      identity=$(git show -s --format='%G? %GP' "$commit")
      if [[ "$identity" != "G $fingerprint" && "$identity" != "U $fingerprint" ]]; then
        echo 'The earlier release stamp must be verified with its original signing key' >&2
        exit 1
      fi
      tag=$(git show "$commit:.version" | tr -d '\r\n')
      python3 deployment/release/version.py check "$tag"
      publish_tag "$tag" "$commit"
      exit 0
    fi
  done < <(git log --first-parent --format=%H --grep="^$marker$" "$head")

  base=$(git show "$head:.version" | tr -d '\r\n')
  tag=$(python3 deployment/release/version.py next -- "$base" "$intent")
  refs=$(git ls-remote origin "refs/tags/$tag")
  [[ -z "$refs" ]] || { echo "Version $tag is already tagged" >&2; exit 1; }
  blob=$(printf '%s\n' "$tag" | git hash-object -w --stdin)
  # Read the branch tree without checking out or running code from a later merge.
  GIT_INDEX_FILE="$index_dir/index" git read-tree "$head"
  GIT_INDEX_FILE="$index_dir/index" git update-index --add --cacheinfo "100644,$blob,.version"
  tree=$(GIT_INDEX_FILE="$index_dir/index" git write-tree)
  commit=$(git -c gpg.format=openpgp commit-tree -S"$fingerprint" "$tree" -p "$head" \
    -m "chore(release): $tag" -m "$marker"$'\n'"$merge_marker")
  if git push origin "$commit:refs/heads/main"; then
    publish_tag "$tag" "$commit"
    exit 0
  fi
  echo "Could not stamp $tag (attempt $attempt), checking main again" >&2
done
exit 1
