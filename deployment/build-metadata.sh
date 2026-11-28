#!/usr/bin/env bash
# Run from the source root. A source archive has a version even without Git.
skyview_build_metadata() {
  version=$(tr -d '\r\n' < .version)
  revision=''
  source_state=unknown
  source_time=''
  local status
  if [[ $(git rev-parse --show-toplevel 2>/dev/null || true) == "$(pwd -P)" ]] &&
    revision=$(git rev-parse --verify HEAD 2>/dev/null); then
    source_time=$(git show -s --format=%cI HEAD)
    if status=$(git status --porcelain --untracked-files=normal); then
      source_state=clean
      if [[ -n "$status" ]]; then source_state=modified; fi
    fi
  fi
}

skyview_link_flags() {
  local package='github.com/Rexus/SkyView'
  printf -- '-X %s.stampedRevision=%s -X %s.stampedSourceState=%s -X %s.stampedSourceTime=%s -X %s.stampedReleaseTag=%s' \
    "$package" "$revision" "$package" "$source_state" "$package" "$source_time" "$package" "${release_tag:-}"
}
