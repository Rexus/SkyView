# SkyView HTTP API

[Back to the project README](../README.md)

This is the application's own project and file API. It is not documented as an implementation
of the OMG Systems Modeling API and Services specification.

Paths are relative to the SkyView server address. `{name}` identifies a workspace `.sysml` file.
Request and response details are defined by [the handlers](../internal/server/handlers.go)
and [the frontend client](../web/src/api.ts).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Service health |
| GET | `/api/about` | Embedded build identity, deployment mode and current account |
| GET | `/api/files` | List workspace models |
| POST | `/api/files` | Create a model or import content |
| GET | `/api/files/{name}` | Read source, parsed model and diagnostics |
| PUT | `/api/files/{name}` | Save source |
| DELETE | `/api/files/{name}` | Delete a model, its layouts and history |
| GET | `/api/files/{name}/download` | Download model source |
| POST | `/api/files/{name}/element` | Add an element |
| PATCH | `/api/files/{name}/element` | Edit element fields |
| DELETE | `/api/files/{name}/element?id=` | Delete an element by ID |
| POST | `/api/files/{name}/connection` | Add a connection |
| POST | `/api/files/{name}/satisfy` | Add a satisfaction link |
| GET/PUT | `/api/files/{name}/layout` | Read or save diagram layout |
| GET | `/api/files/{name}/history` | List model snapshots |
| POST | `/api/files/{name}/restore` | Restore a model snapshot |
| POST | `/api/files/{name}/validate` | Parse submitted source and return diagnostics |

## Access

Local Go and local containers run in single-user mode. With the [hosted deployment](../deployment/caas/),
all application routes use HTTP Basic authentication over HTTPS. The account owns its workspace and
project routes, including the legacy aliases. `/api/health` remains available to probes without credentials
and returns only service status.

`/api/about` responds with `{build, mode, account}` and uses `Cache-Control: no-store`. The account
is `local` in single-user mode and the authenticated username in hosted mode. `build` is the
same identity returned by `skyview version -json`. See [build identity](../CONTRIBUTING.md#build-identity).

## Project routes

All file routes above and shared-view routes below also exist under
`/api/projects/{project}/files/...`. Use that form for new clients. `{project}` is a catalog ID;
`{name}` is a project-relative path encoded as **one URL segment**, e.g. `models%2FPlant.sysml`.
`workspace` addresses legacy root-level files. Project selection never changes another request's root.

| Method | Path | Body / result |
| --- | --- | --- |
| GET | `/api/projects` | `{workspaces: [{id, name}], projects: [{id, version, name, origin, workspaceId?}]}` |
| POST | `/api/workspaces` | JSON `{name}` creates a named workspace |
| PATCH | `/api/projects/{project}/workspace` | JSON `{workspaceId}` reassigns a managed project and returns its metadata |
| POST | `/api/projects` | JSON `{name, example?, workspaceId?}`; creates an independent project |
| POST | `/api/projects/upload` | Multipart `file` (ZIP), `name`, `directory`, optional `workspaceId`; name optional when ZIP has a manifest |
| POST | `/api/projects/git` | JSON `{name, repository, ref, directory, workspaceId?}`; resolves and imports a public snapshot |
| GET | `/api/projects/{project}/export` | ZIP of saved source, views, layouts, assets and manifest |
| GET | `/api/projects/{project}/palette` | Effective language keyword colours, overrides and revision |
| PUT | `/api/projects/{project}/palette` | Save `{version: 1, colours: {keyword: "#rrggbb"}}` with the current `If-Match` revision |
| GET | `/api/examples` | `{examples: [{id, version, name, origin}]}` |

Creation returns 201 with metadata. A missing `workspaceId` selects `default`, and an unknown
workspace ID returns 404. Existing project IDs and file routes are stable across reassignment.
ZIP exports strip server workspace membership. Invalid imports return 400 without publishing a project;
unknown project IDs return 404. No browser route accepts a server-local path. See the
[project guide](projects.md) for selection rules, archive limits and future personal Git integration.
The CLI's `import` and `export` accept `-project ID`; `-name` may contain nested paths.

## Shared views

See [Model exchange and shared views](model-exchange.md) for the CLI, versioned configuration,
ownership and current rendering limits.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/files/{name}/diagram/nodes` | Native compartment glyphs keyed by model ID; source `If-Match` required |
| POST | `/api/files/{name}/views/preview?view={view}&format=scene` | Validated native nodes, annotation frames, edges and canonical SVG for the same draft |
| GET | `/api/files/{name}/views` | Download the exact shared-view sidecar |
| PUT | `/api/files/{name}/views` | Validate and publish selections; `If-Match` must contain the source `revision` |
| POST | `/api/files/{name}/views/preview?view={view}` | Validate/render a complete draft config without saving; source `If-Match` required |
| GET | `/api/files/{name}/views/{view}` | Render the selected view as SVG, identical to the CLI |

Scene nodes carry native `elementId` (absent for annotation frames), a view key, parent key,
absolute geometry, native port handles and the canonical per-node SVG glyph. Edges retain native
relationship identity/direction and their canonical drawing. `scene.svg` is the exact full export for
that validated view. The browser attaches these objects to its common interactive canvas; it never
infers semantic elements from SVG markup. The CLI uses the same drawing engine directly.

Sidecar GET and successful PUT return `ETag`. Clients send optional `If-View-Match` on PUT to
protect an existing sidecar against concurrent changes; mismatches return 409. Browser saves use
both source and view revisions.

View publication rejects unknown fields and invalid selections. A changed model revision returns
409; an unsupported or inconsistent selection returns 422. Read routes return 404 for missing
models/views. Deleting a model also deletes its shared sidecar. These are application APIs, not an
implementation of the OMG Systems Modeling API.

## Source diagnostics

`POST /api/files/{name}/validate` accepts `{"content":"..."}` and returns `diagnostics` for that
exact draft without changing stored source. File read/save responses also include diagnostics.
These are SkyView's partial parser checks, not full native SysML conformance results.

Each diagnostic has `severity`, `message`, 1-based `line` and UTF-8-byte `column`, and optionally
`elementId`. `range: {"start": n, "end": m}` is a half-open UTF-8 byte range in the submitted text;
an empty range marks an insertion point, including end-of-file. Clients must convert offsets to
their editor's character encoding (CodeMirror uses UTF-16). Optional `hint` gives review guidance
for a possible correction. Existing fields remain available for older consumers.

An empty successful diagnostic list means no issues were detected by the supported checks.
A failed validation request must be reported as unavailable, never as a successful empty result.

## Native project validation

`POST /api/projects/{project}/files/{name}/validate-native` (or the legacy `/api/files/{name}/validate-native`)
accepts optional `{"content":"unsaved source"}`. It checks a bounded complete source snapshot without saving.
The JSON result has `status` (`passed`, `failed`, `unavailable`), `release`, `identity` (lock and adapter hashes), `sourceSHA256`, `filesChecked`,
`diagnostics` (with project-relative `file`, severity, message and UTF-8 ranges), separate
`libraryDiagnostics` for official-library defects, and optional `error`. A project pass can retain library
findings; the CLI `-strict-library` option fails on those too.
HTTP 200 means a validation attempt returned a typed outcome; clients must inspect `status`.
Invalid requests return HTTP 400. See [native checker details](standards.md#editor-and-api).

`GET /api/standards` returns the running build's `release`, `lockSHA256`, `adapterSHA256`,
`state` (`verified` or `unavailable`), validation `scope` and optional `error`. It verifies installed
artifact hashes against the embedded release lock, uses `Cache-Control: no-store`, and supplies the
footer. A verified installation is not a model validation result or full-conformance claim.
