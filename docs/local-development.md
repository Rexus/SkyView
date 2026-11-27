# Run SkyView locally

[Back to the README](../README.md)

Use either the native Go app or a Linux container. Both serve the same interface and store models
in a workspace directory. The examples use port **8081**, so SkyView can run alongside SysON on 8080.

## Contents

- [Go app](#go-app)
- [Docker](#docker)
- [Podman](#podman)
- [Data and recovery](#data-and-recovery)

## Go app

Install [Go](https://go.dev/dl/) 1.24 or later. Reopen your terminal after installation so `go` is
on its PATH. The checked-in interface lets you start without Node.js or Nix.

From the repository root:

```sh
go run ./cmd/skyview -addr 127.0.0.1:8081
```

Open [SkyView](http://127.0.0.1:8081). Select `example-model.sysml`, then open the Grid, Diagram,
Requirements or Source tab. Stop the server with Ctrl+C.

To use your own model directory, append `-workspace ./my-models`. Paths are relative to the directory
where you start the application. The default is `./workspace`.

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

Keep `LICENSE` and `THIRD_PARTY_NOTICES.md` with copies of the executable.
See [Development](../README.md#development) before changing or rebuilding the interface.

## Docker

Install Docker Engine or Docker Desktop with Linux containers enabled and start its engine.
From the repository root, build and start:

```sh
docker build -t skyview:local .
docker run -d --name skyview -p 127.0.0.1:8081:8080 -v skyview-workspace:/data skyview:local
```

Open [SkyView](http://127.0.0.1:8081). The image builds the interface and Go executable itself;
Go and Node.js are not required on the host.

The named volume `skyview-workspace` is created automatically. It retains your models, layouts and
history when the container is removed. The image runs as UID/GID 65532 and includes a writable
`/data` directory for the initial volume.

Inspect logs, stop, and start the same container:

```sh
docker logs skyview
docker stop skyview
docker start skyview
```

After rebuilding the image, recreate the stopped container with the same volume:

```sh
docker stop skyview
docker rm skyview
docker run -d --name skyview -p 127.0.0.1:8081:8080 -v skyview-workspace:/data skyview:local
```

## Podman

Install Podman. On Windows or macOS, initialize a Podman machine once with `podman machine init`,
then start it with `podman machine start`. A native Linux installation does not need that VM.

From the repository root:

```sh
podman build -t localhost/skyview:local .
podman run -d --name skyview -p 127.0.0.1:8081:8080 -v skyview-workspace:/data:U localhost/skyview:local
```

Open [SkyView](http://127.0.0.1:8081). The `:U` option sets ownership of this named volume for the
container user. Docker and Podman have separate image and volume stores.

Use `podman logs skyview`, `podman stop skyview` and `podman start skyview` to manage the container.
To update it, rebuild, stop and remove the container, then repeat the run command with the same volume.

## Data and recovery

The native app's `./workspace` and the container's named volume are separate workspaces.
Import or download individual `.sysml` files through the UI to move models between them.
Copy the entire workspace when you also want diagram layouts and history.

For a container backup, stop SkyView and copy its workspace to a new local directory:

```sh
docker stop skyview
docker cp skyview:/data ./skyview-backup
docker start skyview
```

Use the equivalent `podman` commands for a Podman container. To inspect a backup with the native app,
run `go run ./cmd/skyview -addr 127.0.0.1:8081 -workspace ./skyview-backup` after stopping any other
SkyView process on port 8081.

The History dialog can restore saved model snapshots. Deleting a model in the UI also deletes its
history and layout, so retain independent backups. Removing the named volume deletes all its data.

If startup fails, check the logs and whether port 8081 is already in use. For a native workspace,
check that your account can write to the selected directory. For containers, use a fresh named volume
or ensure an existing one is writable by the container user.

These examples expose the app only on localhost. SkyView has no built-in authentication.
