# SkyView HTTP API

[Back to the project README](../README.md)

This is the application's own file-oriented API. It is not documented as an implementation
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
