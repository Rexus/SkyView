# Initial baseline

[Back to the README](../README.md)

Prepared on 2026-11-27 for the public `Rexus/SkyView` repository.

## Origin and scope

The original commit `e6a038f5446484a7760b66ce90468f8021846fc0` is retained in the Git history.
Carl Maier created the initial workbench. The public baseline adds the MIT license naming
Carl Maier and Viktor Ingre, third-party notices, documentation and local startup packaging.

The Go module path is `github.com/Rexus/SkyView`. The container creates `/data` with ownership
for UID/GID 65532; without this change the original image exited with a permission error.
Container image references are qualified for Docker and Podman. Shell-script line endings
are pinned to LF. The parser and editing behavior are unchanged from the original commit.

## Verification

| Check | Result |
| --- | --- |
| Locked frontend install and TypeScript/Vite build | Passed in the Docker build with Node.js 22 |
| Existing Go tests | All three passed with the Go 1.24 container toolchain |
| `go vet ./...` | Passed with the Go 1.24 container toolchain |
| Linux container build | Passed |
| Container startup, HTTP interface and bundled model | Passed; sample parsed as 53 elements |
| Model save, snapshot creation and exact restore | Passed through the HTTP API |
| Model, history and layout persistence | Passed after removing and recreating the container with the same named volume |
| Windows amd64 executable build | Passed using the Go cross-compiler |
| Windows native execution | Blocked by this laptop's Application Control policy |
| Native `go run` on Windows | Not verified; Go installation awaited Windows approval |
| Podman execution | Not verified; Podman was not installed on the verification host |
| Browser interaction and visual inspection | Not verified; the browser preview could not attach |
| Documentation links and whitespace | Passed |

The tests above establish the recorded startup and storage behavior only. They do not establish
OMG conformance or arbitrary model round-trip correctness. Podman commands are documented
for the same Dockerfile, with a named volume owned by the container user.

## Continuing development

Use this baseline as the comparison point for later fixes. Track parser, semantic and editing
changes separately, with examples and checks that demonstrate the intended behavior.
Refresh the recorded limitations when the relevant path has actually been exercised.
