# SkyView architecture

[Back to SkyView](../README.md) · [Project workflow](../docs/projects.md)

SkyView keeps its Go service and React workbench. Project management is an in-process capability:
there is no extra service, database or Git daemon. The native
[ProjectWorkspaces model](models/ProjectWorkspaces.sysml) owns the accepted project responsibilities,
use cases and five workspace, storage and import guardrails. It is an incremental contract for this feature, not a
claim that the entire application has been modeled.

| Native responsibility | Owning implementation | Consumer |
| --- | --- | --- |
| Browser | `web/src/components/ProjectBar.tsx`, `web/src/projects.ts` | Header workspace selector, project picker, examples, ZIP and Git forms |
| ProjectCatalog | `internal/server/projects.go`, `workspaces.go` | Workspace assignments, CLI-configured folders and `/api/projects` |
| ProjectStore | `internal/projects/paths.go`, `projects.go`, `archive.go` | Bounded import, atomic publication, ZIP export |
| SnapshotImporter | `internal/projects/git.go` | Public provider APIs, pinned commit provenance |
| ExampleLibrary | `examples/examples.go`, adjacent example directories | Independent editable project copies |
| ModelWorkbench | `internal/server/routes.go`, file/view handlers, `web/src/api.ts`, `internal/cli/cli.go` | Every model/view/history call carries the selected project identity |

The [verification record](../docs/projects.md#verification) maps each modeled obligation to exercised
checks and records remaining live-provider limits. Source/editor behavior and shared-renderer ownership
are described in [model exchange](../docs/model-exchange.md) and the [API](../docs/api.md).

## Deployment

[Deployment.sysml](models/Deployment.sysml) defines the local and hosted access boundaries.
The [Go](../deployment/go/) and [Docker or Podman](../deployment/docker/) deployment paths serve
one local workspace each. In [hosted mode](../deployment/caas/), the ingress terminates HTTPS and
`internal/server/hosted.go` checks accounts before handing requests to a separate workspace catalog.
The initial `root` account adopts the existing volume workspace. The deployment operator owns account
configuration. Account-bound Git writes remain a future capability.

`TestHostedModeSeparatesAccountWorkspaces` checks DP-01 through the HTTP routes. It covers anonymous
access, a root workspace upgrade, an example imported into a second account, cross-account reads
and exports, restart persistence and credential rotation.

## Standards validation

[StandardsValidation.sysml](models/StandardsValidation.sysml) defines the native checker boundary,
project snapshot behavior, published/preview build selection and five integrity/failure guardrails. `internal/standards/` owns toolchain
setup and isolated execution; `internal/cli/standards.go` owns the shared repository gate;
`internal/server/standards.go` and `SourceView.tsx` expose draft validation. See the
[authority, operating and verification map](../docs/standards.md) and [viewer direction](../docs/viewer-design.md).

## Shared presentation

[SharedPresentation.sysml](models/SharedPresentation.sysml) separates native model meaning from view
geometry and defines source preservation, portable rendering and locked-group obligations.
`internal/views/` owns source validation and the canonical drawing engine. `scene.go` decomposes its
exact drawing into native node/edge glyphs plus annotation glyphs; `node_glyph.go` supplies the native
compartment drawing used by automatic diagrams and detailed saved nodes. `internal/server/views.go`
serves these from the same service/parser and enforces source/view revision checks.

`DiagramCanvas.tsx` is the sole ReactFlow surface. Both automatic scopes and saved view selections
use `SysmlNode.tsx`, native port handles and `diagramConnections.ts`; `useSavedDiagram.ts` adapts saved
geometry to native node IDs and relative parent positions. `WorkbenchSidebar.tsx` owns navigation;
`CustomViews.tsx`, `SharedSettings.tsx` and `KeywordPalette.tsx` manage presentation drafts. The old
whole-SVG surface is removed. SVG is an export of the effective view, not an alternate viewer.

`sharedLayout.ts` and `sharedRouting.ts` arrange bounded selections from the inside out. The
[presentation guide](../docs/shared-presentation.md) maps controls, format and checks.
