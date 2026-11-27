# SkyView deployments

SkyView uses the same application in two modes.

| Deployment | Mode | Storage |
| --- | --- | --- |
| [Local Go](go/) | Single-user on localhost | A local workspace directory |
| [Docker or Podman](docker/) | Single-user on localhost | A named container volume |
| [Hosted Kubernetes](caas/) | Multi-user sign-in over HTTPS | One persistent volume with a workspace per account |

See the [architecture](../architecture/README.md#deployment) for account and storage boundaries.
Use [project export and import](../docs/projects.md) to move a project between deployments.
