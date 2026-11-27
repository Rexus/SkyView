# SkyView with Docker or Podman

[Deployment options](../README.md)

Run a local single-user workbench and keep your projects on a named volume.

## Docker

Install Docker Engine or Docker Desktop with Linux containers enabled and start its engine.
From the repository root, build and start:

```sh
bash deployment/docker/build.sh -t skyview:local
docker run -d --name skyview -p 127.0.0.1:8081:8080 -v skyview-workspace:/data skyview:local
```

Open [SkyView](http://127.0.0.1:8081). The image builds the interface and Go executable itself;
Go and Node.js are not required on the host. Builds default to published OMG standards.
The commands use Bash to record available Git metadata in the OCI image and running binary.
On Windows, use Git Bash or WSL with Docker integration.
For preview selection and refreshing the cached release lookup on rebuild, see [build channels](../../docs/standards.md#build-channels).

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
CONTAINER_ENGINE=podman bash deployment/docker/build.sh -t localhost/skyview:local
podman run -d --name skyview -p 127.0.0.1:8081:8080 -v skyview-workspace:/data:U localhost/skyview:local
```

Open [SkyView](http://127.0.0.1:8081). The `:U` option sets ownership of this named volume for the
container user. Docker and Podman have separate image and volume stores.

Use `podman logs skyview`, `podman stop skyview` and `podman start skyview` to manage the container.
To update it, rebuild, stop and remove the container, then repeat the run command with the same volume.

See [workspace recovery](../../docs/local-development.md#data-and-recovery) for backups.
