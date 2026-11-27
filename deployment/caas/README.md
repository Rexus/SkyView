# Hosted SkyView on Kubernetes

[Deployment options](../README.md)

Hosted SkyView serves SkyView over HTTPS with browser sign-in. Its initial application account
is `root`. Supply a generated password for `root` and one for each additional account through a
Kubernetes Secret. Account changes take effect when the SkyView pod restarts.

Each account has its own projects, layouts and history. The `root` account adopts the existing
volume's workspace when you upgrade an earlier deployment. Other accounts use
`/data/.skyview/users/<name>`. The deployment operator manages accounts through Kubernetes.
Users move models between accounts by exporting and importing project ZIPs.

## Prepare the cluster

Set the hostname in `20-deployment.yaml` and `40-ingress.yaml`. Set the registry image in
`20-deployment.yaml` and `skaffold.yaml`, the storage class in `10-pvc.yaml`, and the ingress class,
HTTPS entrypoint and certificate issuer in `40-ingress.yaml` for your cluster. Point the hostname
at the ingress and confirm it has a trusted certificate. Keep the SkyView Service internal to
the cluster so browser traffic passes through the HTTPS ingress.

Run these commands from the repository root. Create the namespace first.

```sh
kubectl apply -f deployment/caas/00-namespace.yaml
```

Create an `accounts.json` file outside the repository in a restricted directory. Use a password
manager to generate a unique random password of at least 24 characters per account.
The JSON is an array of objects with `name` and `password` fields. Names use lowercase letters, digits
and hyphens, start with a letter, and are at most 32 characters. Start with `root` and add other accounts
as needed.

```json
[
  {"name": "root", "password": "..."}
]
```

Replace the placeholder with the generated password before creating the Secret.

```sh
kubectl -n skyview create secret generic skyview-accounts \
  --from-file=accounts.json=/secure/path/accounts.json
```

The Secret is mounted read-only. Store a secure backup of the account configuration alongside your
volume recovery procedure. For existing deployments, back up the volume before changing modes.

## Deploy

Use the container digest listed with the [official release](https://github.com/Rexus/SkyView/releases),
or build a test image with [the container build script](../docker/). Set the image in the manifest
and grant the cluster pull access where needed.

```sh
kubectl kustomize deployment/caas
kubectl apply -k deployment/caas
kubectl -n skyview rollout status deployment/skyview
```

Open the configured HTTPS address and sign in as `root` in the browser prompt. Use a separate browser
profile or private window to sign in as another account. `curl --user root https://skyview.example.com/api/projects`
prompts for the password when checking the API. `GET /api/health` returns service status for probes.

For development, `make deploy` or `make deploy-dev` uses the [Skaffold configuration](skaffold.yaml)
from the repository root. Its build uses Docker and Skopeo. Authenticate Skopeo to a trusted registry
before running it, for example with `skopeo login registry.example.com`. Use `SKAFFOLD_FLAGS` for
site-specific Skaffold options. `make deploy-dev` keeps the namespace and volume on exit.
A registry with a private CA should be trusted by the builder and cluster.

## Rotate credentials and back up data

Update the file, apply the Secret, then restart the deployment.

```sh
kubectl -n skyview create secret generic skyview-accounts \
  --from-file=accounts.json=/secure/path/accounts.json --dry-run=client -o yaml | kubectl apply -f -
kubectl -n skyview rollout restart deployment/skyview
kubectl -n skyview rollout status deployment/skyview
```

To revoke access, remove the account from the Secret and restart. Its data stays on the volume.
Re-adding the same username restores access to those files.

Back up the complete `skyview-workspace` volume. The deployment uses one non-root replica and
a `ReadWriteOnce` volume, with the `Recreate` strategy for upgrades. Upgrades and password rotation
briefly interrupt access. Horizontal scaling and shared live project editing are outside this deployment.
