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

## Project routes

All file routes above and shared-view routes below also exist under
`/api/projects/{project}/files/...`. Use that form for new clients. `{project}` is a catalog ID;
`{name}` is a project-relative path encoded as **one URL segment**, e.g. `models%2FPlant.sysml`.
`workspace` addresses legacy root-level files. Project selection never changes another request's root.

| Method | Path | Body / result |
| --- | --- | --- |
| GET | `/api/projects` | `{projects: [{id, version, name, origin}]}` |
| POST | `/api/projects` | JSON `{name, example?}`; creates an independent project |
| POST | `/api/projects/upload` | Multipart `file` (ZIP), `name`, `directory`; name optional when ZIP has a manifest |
| POST | `/api/projects/git` | JSON `{name, repository, ref, directory}`; resolves and imports a public snapshot |
| GET | `/api/projects/{project}/export` | ZIP of saved source, views, layouts, assets and manifest |
| GET | `/api/examples` | `{examples: [{id, version, name, origin}]}` |

Creation returns 201 with project metadata. Invalid imports return 400 without publishing a project;
unknown project IDs return 404. No browser route accepts a server-local path. See the
[project guide](projects.md) for selection rules, archive limits and future personal Git integration.
The CLI's `import` and `export` accept `-project ID`; `-name` may contain nested paths.

## Shared views

See [Model exchange and shared views](model-exchange.md) for the CLI, versioned configuration,
ownership and current rendering limits.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/files/{name}/views` | Download the exact shared-view sidecar |
| PUT | `/api/files/{name}/views` | Validate and publish selections; `If-Match` must contain the source `revision` |
| GET | `/api/files/{name}/views/{view}` | Render the selected view as SVG, identical to the CLI |

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
