# SkyView on Kubernetes

Deploys SkyView behind Traefik at **`https://skyview.example.com`**.

## What is created

| File | Resource |
|---|---|
| `00-namespace.yaml` | namespace `skyview` |
| `10-pvc.yaml` | `skyview-workspace` PVC, 5 GiB on `rook-ceph-block` |
| `20-deployment.yaml` | one non-root replica; workspace at `/data` |
| `30-service.yaml` | ClusterIP service on port 80 |
| `40-ingress.yaml` | Traefik ingress + TLS via `example-ca` |

The binary embeds the web UI and seeds the example sample model into the PVC on
first start. The PVC keeps models, version history and diagram layouts across
restarts.

## Deploy

```sh
make deploy
```

`make deploy` builds with the custom Skaffold builder
(`scripts/build-image.sh`), pushes to
`registry.example.com/library/skyview` with Skopeo, and applies the
kustomization. The Skopeo push and Skaffold's digest lookup skip TLS
verification for the registry because the build host does not trust its
self-signed CA:

```sh
HARBOR_USER=admin HARBOR_PASSWORD=... \
  skaffold run --cache-artifacts=false --insecure-registry=registry.example.com
```

For a live loop:

```sh
make deploy-dev
```

The `library` Harbor project is public, so pods pull the image without an
`imagePullSecrets` entry.

## DNS

Point `skyview.example.com` at the load balancer IP in your DNS provider.
Traefik routes by Host header; cert-manager issues the certificate from the
`example-ca` ClusterIssuer.

## Notes

- One replica is intentional: the workspace is a ReadWriteOnce PVC.
- The container runs as UID/GID 65532 with a read-only root filesystem; only
  `/data` and `/tmp` are writable.
- `readinessProbe` and `livenessProbe` use `/api/health`.
