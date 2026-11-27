# SkyView

Repository: <https://example.com/your-org/skyview>

A modern SysML v2 workbench: a Go server with a React UI that reads and writes
`.sysml` textual models directly, shows them as an editable grid, auto-laid-out
interconnection/containment diagrams, a requirements table with traceability,
and a syntax-highlighted source editor.

The source file stays the single source of truth. Every structured edit is
applied as a precise source edit and re-parsed, so the model round-trips without
rewriting the whole file.

## Features

- **Grid editor** — every element in the model in one editable table. Edit
  names, types, values and documentation inline. Add/delete elements,
  connections and satisfy links.
- **Diagram view** — auto-laid-out interconnection and containment diagrams with
  React Flow. Nodes carry SysON-style compartments for documentation and
  inherited attributes, plus ports inherited from a part's type. Drag a port
  handle onto another port to create a connection, drag nodes to arrange, and
  the layout is persisted per scope.
- **Diagram notes** — add a note from the diagram toolbar; it is attached to the
  selected node with a dashed leader line, can be dragged and edited inline, and
  is stored in the diagram layout alongside node positions.
- **Requirements view** — requirements with their text, satisfy links and a
  traceability matrix. Edit requirement text and add trace links.
- **Source view** — CodeMirror 6 editor with SysML syntax highlighting, live
  diagnostics, line jump and save.
- **Import** — drag `.sysml` files from your desktop onto the app, or use the
  import dialog. Names are sanitized to workspace rules and conflicts can be
  renamed before import.
- **Undo / redo** — `⌘Z` / `⇧⌘Z` (`Ctrl+Z` / `Ctrl+Y` on Linux) for visual model
  edits, with the same behaviour as the rest of the UI.
- **Version history** — a snapshot is written before every save and can be
  restored from the History dialog.
- **Diagnostics** — tolerant parser plus semantic checks (unresolved types,
  connection endpoints, satisfy targets, duplicate names).
- **Modern UX** — dark/light themes, command palette (`⌘K`), keyboard
  navigation, responsive layout.

## Quick start

```sh
cd skyview
nix develop
```

In two terminals:

```sh
make dev-api        # Go API + built UI on http://localhost:8080
make dev-web        # Vite dev server on http://localhost:5173 (proxies /api)
```

Or build the single binary:

```sh
make build
./bin/skyview
```

The default workspace is `./workspace`; it is seeded with
`example-model.sysml` if no model is present. Set `SKYVIEW_WORKSPACE` or pass
`-workspace` to use another directory. `SKYVIEW_ADDR` / `-addr` changes the
listen address (default `0.0.0.0:8080`).

## Layout

```text
cmd/skyview/          entry point
internal/sysml/       lexer, parser, model, semantic checks, source edits
internal/server/      HTTP API, file/history/layout storage, embedded UI
web/                  React + TypeScript + Vite frontend
kubernetes/           namespace, PVC, deployment, service, Traefik ingress
skaffold.yaml         build + deploy to a Kubernetes cluster
workspace/            default model workspace (sample SysML model)
```

## SysML coverage

The parser handles the subset used by the example model and common SysML v2
textual notation:

- packages, imports and `doc` comments
- `part`, `port`, `attribute`, `requirement`, `action`, `state`, `item`,
  `interface`, `allocation`, `constraint`, `calc`, `case`, `analysis`,
  `verification`, `view`, `rendering`, `concern` definitions and usages
- `specializes`, types, multiplicities and feature values
- `connection ... connect ... to ...`
- `satisfy ... by ...`
- tolerant parsing: unknown constructs produce diagnostics instead of losing the
  rest of the file

It is intentionally a practical workbench parser, not a complete SysML v2
semantic implementation.

## Kubernetes

`kubernetes/` deploys the app behind Traefik:

- namespace `skyview`
- `skyview-workspace` PVC (5 GiB, `rook-ceph-block`)
- one replica, distroless non-root image, `/data` mounted
- service on port 80
- ingress at **`skyview.example.com`** with TLS from the `example-ca`
  ClusterIssuer

Build and deploy with Skaffold:

```sh
make deploy            # or: make deploy-dev
```

`make deploy` reads the Harbor admin password from the in-cluster
`harbor/harbor-core` secret when `HARBOR_PASSWORD` is not set. To run Skaffold
directly:

```sh
HARBOR_USER=admin HARBOR_PASSWORD=... \
  skaffold run --cache-artifacts=false --insecure-registry=registry.example.com
```

The image is pushed to `registry.example.com/library/skyview`. The custom
build script (`scripts/build-image.sh`) uses Skopeo for the push because the
build host's Docker daemon does not trust the registry's self-signed CA; the
`--insecure-registry` flag does the same for Skaffold's digest lookup.

The app is served at **https://skyview.example.com**. Point DNS:
`skyview.example.com -> <load-balancer-IP>`. TLS is issued by cert-manager
from the `example-ca` ClusterIssuer.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/files` | list workspace models |
| POST | `/api/files` | create a model (or import content) |
| GET | `/api/files/{name}` | raw source + parsed model + diagnostics |
| PUT | `/api/files/{name}` | save raw source |
| DELETE | `/api/files/{name}` | delete a model |
| POST | `/api/files/{name}/element` | add an element |
| PATCH | `/api/files/{name}/element` | edit name/type/doc/value |
| DELETE | `/api/files/{name}/element?id=` | delete an element |
| POST | `/api/files/{name}/connection` | add a connection |
| POST | `/api/files/{name}/satisfy` | add a satisfy link |
| GET/PUT | `/api/files/{name}/layout` | diagram layout |
| GET | `/api/files/{name}/history` | snapshots |
| POST | `/api/files/{name}/restore` | restore a snapshot |
| POST | `/api/files/{name}/validate` | parse diagnostics |

## Development

```sh
make test     # Go parser and edit tests
make vet
make fmt
```

The Go tests cover the example model, structured edits and
connection/satisfy resolution.

## Notes

- The sample model is a small fictional SysML v2 example used to exercise the
  UI and parser. Update `workspace/example-model.sysml` as needed.
- Workspace history and layouts live in `workspace/.skyview/` and are ignored by
  git.
