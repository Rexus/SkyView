# SkyView architecture

[Back to SkyView](../README.md) · [Project workflow](../docs/projects.md)

SkyView keeps its Go service and React workbench. Project management is an in-process capability:
there is no extra service, database or Git daemon. The native
[ProjectWorkspaces model](models/ProjectWorkspaces.sysml) owns the accepted project responsibilities,
use cases and four storage/import guardrails. It is an incremental contract for this feature, not a
claim that the entire application has been modeled.

| Native responsibility | Owning implementation | Consumer |
| --- | --- | --- |
| Browser | `web/src/components/ProjectBar.tsx`, `web/src/projects.ts` | Project picker, examples, ZIP and Git forms |
| ProjectCatalog | `internal/server/projects.go` | CLI-configured folders and `/api/projects` |
| ProjectStore | `internal/projects/paths.go`, `projects.go`, `archive.go` | Bounded import, atomic publication, ZIP export |
| SnapshotImporter | `internal/projects/git.go` | Public provider APIs, pinned commit provenance |
| ExampleLibrary | `examples/examples.go`, adjacent example directories | Independent editable project copies |
| ModelWorkbench | `internal/server/routes.go`, file/view handlers, `web/src/api.ts`, `internal/cli/cli.go` | Every model/view/history call carries the selected project identity |

The [verification record](../docs/projects.md#verification) maps each modeled obligation to exercised
checks and records remaining live-provider limits. Source/editor behavior and shared-renderer ownership
are described in [model exchange](../docs/model-exchange.md) and the [API](../docs/api.md).

Future distributed operation needs authenticated personal users, project authorization and explicit
per-user Git permissions before commit/push support. The current snapshot provenance is descriptive;
it is not an identity or credential store. This boundary follows the agreed first-version scope.
