#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
channel="${SYSML_CHANNEL:-published}"
# Only the identity lock is source-controlled; all downloaded binaries/models stay in ignored bin/.
go run ./cmd/skyview standards-update -channel "$channel" -cache bin/sysml-downloads
npm --prefix web run build
mkdir -p bin/local
go build -trimpath -o bin/local/skyview ./cmd/skyview
bin/local/skyview standards-setup -toolchain "bin/local/sysml-$(bin/local/skyview standards-version)" -cache bin/sysml-downloads
cp LICENSE THIRD_PARTY_NOTICES.md bin/local/
cp internal/standards/release.json bin/local/standards-release.json
bin/local/skyview standards-info >/dev/null
printf 'Local bundle ready: bin/local/skyview\n'
