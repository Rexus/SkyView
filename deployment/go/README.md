# SkyView with Go

[Deployment options](../README.md)

Run a single-user workbench locally. Go binds to localhost by default.

## Go app

Install [Go](https://go.dev/dl/) 1.24 or later. Reopen your terminal after installation so `go` is
on its PATH. The checked-in interface lets you start without Node.js or Nix.

From the repository root:

```sh
go run ./cmd/skyview -addr 127.0.0.1:8081
```

Open [SkyView](http://127.0.0.1:8081). Use **Projects → Examples** to start an editable example, then
open Grid, Diagram, Requirements or Source. Stop the server with Ctrl+C.
See [projects](../../docs/projects.md) for ZIP uploads, repository snapshots and local folders.

`-workspace ./my-workspace` chooses the persistent workspace root (default `./workspace`).
To expose an existing model directory or checkout, add `-project NAME=PATH`; see the
[local project guide](../../docs/projects.md#local-folders). Paths are relative to where you start the app.

To build and run an executable on Windows, from the repository root:

```powershell
go build -o bin/skyview.exe ./cmd/skyview
./bin/skyview.exe -addr 127.0.0.1:8081
```

On Linux or macOS:

```sh
go build -o bin/skyview ./cmd/skyview
./bin/skyview -addr 127.0.0.1:8081
```

For a build that checks for a newer published OMG release and bundles the local checker, run
`bash deployment/go/build.sh` from the repository root with Node.js and JDK 21+ installed. Run
`bin/local/skyview -addr 127.0.0.1:8081` afterward. Set `SYSML_CHANNEL=latest` to include preview standards,
or `SYSML_CHANNEL=locked` for the recorded release. See [build channels](../../docs/standards.md#build-channels).
Raw `go build` uses the current lock and leaves native-check setup separate.

Keep `LICENSE` and `THIRD_PARTY_NOTICES.md` with copies of the executable.
See [Development](../../README.md#development) before changing or rebuilding the interface.

## Windows with AlmaLinux WSL

This route runs the Linux Go toolchain while keeping Windows Smart App Control enabled.
It uses the same repository and workspace on your Windows drive; no second checkout or container
is required. A Linux executable built here runs inside WSL.

With an existing `AlmaLinux-10` WSL distribution, install Go once from a PowerShell terminal:

```powershell
wsl -d AlmaLinux-10 --user root --exec dnf install --assumeyes golang
```

Then, from the repository root in PowerShell, start SkyView:

```powershell
wsl -d AlmaLinux-10 --exec go run ./cmd/skyview -addr 127.0.0.1:8081
```

Keep that terminal open and visit [SkyView](http://127.0.0.1:8081) in your Windows browser.
Press Ctrl+C in the terminal to stop it. WSL inherits the current repository directory, so the
default `./workspace` is the same folder used by the Windows checkout. Stop any other SkyView
instance using port 8081 before starting this one.

To run the checks from the same PowerShell directory:

```powershell
wsl -d AlmaLinux-10 --exec go test -timeout 90s . ./cmd/... ./internal/... ./examples/...
wsl -d AlmaLinux-10 --exec go vet . ./cmd/... ./internal/... ./examples/...
```

If you use a different distribution name, find it with `wsl --list --quiet` and replace
`AlmaLinux-10` in the commands. The installation command above applies to AlmaLinux.
Windows-native `.exe` files remain subject to Windows Application Control; Git commit signing
does not sign those executables.

See [source validation and workspace recovery](../../docs/local-development.md).
