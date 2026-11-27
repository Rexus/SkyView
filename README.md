# SkyView

**Visual systems modeling, grounded in SysML source.**

SkyView is a browser-based SysML v2 workbench with a Go backend and a React interface.
Explore and edit systems through diagrams, tables, requirements and source code, with models
stored as plain `.sysml` files.

SkyView is experimental and implements a subset of SysML v2. OMG conformance has not been established.
See the [initial baseline record](docs/baseline.md) for its origin, verification and known limits.

[![SkyView displaying the inspection drone's connected subsystems](docs/images/skyview-drone.jpg)](docs/images/skyview-drone.jpg)

Explore the [inspection drone example](docs/drone-example.md): connected subsystems, four requirements,
mission behavior and planned verification checks. The native-valid model loads without diagnostics.
The guide includes a generated sequence preview and the current behavior-view limitations.

Try the [inverted pendulum example](docs/pendulum-example.md) for a cart-on-a-rail control problem:
physical parts, a Simulink-style signal loop, swing-up and automatic balance, requirements,
and an optional runnable scientific simulation.

**Contents:** [Features](#features) · [Quick start](#quick-start) · [Development](#development) ·
[Language support](#language-support) · [Project layout](#project-layout) · [Origins](#origins)

## Features

- **Visual modeling:** interconnection and containment diagrams, automatic layout, port connections,
  saved node positions and diagram notes.
- **Grid editing:** edit element names, types, values and documentation; add or remove elements.
- **Requirements:** inspect native constraints, satisfaction assertions and planned verification links.
- **Source editing:** syntax highlighting, [inline diagnostics and suggested fixes](docs/local-development.md#source-validation), and direct access to the model text.
- **File workflows:** import and download `.sysml` files, undo and redo visual model edits,
  and restore saved model snapshots.
- **Shared views:** import/export native model bundles and render selected views consistently in the
  browser or CLI. See [model exchange and shared views](docs/model-exchange.md).
- **Projects:** independent directories with nested models and views; bundled examples, ZIP upload/export,
  public GitHub/GitLab snapshots and configured local folders. See the [project guide](docs/projects.md).
- **Workspace UI:** model navigation, a command palette, and light and dark themes.

Structured edits modify the source text and reparse the model. Diagram positions and notes are stored
separately. Reliable preservation of arbitrary SysML models across edits remains to be verified.

## Quick start

Install Go 1.24 or later. From the repository root, run:

```sh
go run ./cmd/skyview -addr 127.0.0.1:8081
```

Open [SkyView](http://127.0.0.1:8081), choose **Projects → Examples**, and use the inspection drone,
inverted pendulum or starter system. Each opens as an independent editable project.
The repository includes a built web interface, so this first run does not require Node.js or Nix.
Port 8081 lets SkyView run alongside SysON on 8080. See the [local run guide](docs/local-development.md)
for standalone executables, Docker, Podman, persistent storage and backups.
On Windows with Smart App Control, use the [AlmaLinux WSL path](docs/local-development.md#windows-with-almalinux-wsl).

For Docker, from the repository root:

```sh
docker build -t skyview:local .
docker run -d --name skyview -p 127.0.0.1:8081:8080 -v skyview-workspace:/data skyview:local
```

Managed projects are stored in `./workspace/projects/`; Docker uses the `skyview-workspace` named volume.
Existing root-level files remain available as **Workspace files**. Each project keeps its models, views,
layouts and history together. Back up the whole workspace and any separately configured project folders.
See [project storage and portability](docs/projects.md#directory-format).

| Setting | Command-line flag | Environment variable | Default |
| --- | --- | --- | --- |
| Workspace directory | `-workspace` | `SKYVIEW_WORKSPACE` | `./workspace` |
| Local project folder (repeatable) | `-project NAME=PATH` | — | None |
| Listen address | `-addr` | `SKYVIEW_ADDR` | `0.0.0.0:8080` |

Command-line flags override environment variables. The quick-start command binds to localhost;
the default address listens on all interfaces. The application has no built-in authentication.

## Development

To rebuild the interface, use Node.js 22 and npm in addition to Go. From the repository root:

```sh
npm --prefix web ci
npm --prefix web run build
```

The frontend build writes to `internal/server/dist/`, which Go embeds in the application.
Restart the Go server after rebuilding to serve the updated interface.

For live frontend development, start the Go server with `-addr 127.0.0.1:8080` and start a second terminal
at the repository root:

```sh
npm --prefix web run dev -- --host 127.0.0.1
```

Open [the development interface](http://127.0.0.1:5173). Its API requests are forwarded to the Go server.

Run the existing Go checks from the repository root:

```sh
go test ./cmd/... ./internal/... ./examples/...
go vet ./cmd/... ./internal/... ./examples/...
```

The tests cover the bundled models, scoped reference resolution, behavior and constraint parsing,
source edits, quoted identifiers and model exchange. They are not a SysML conformance suite.

To build a standalone executable after building the interface, use
`go build -o bin/skyview.exe ./cmd/skyview` on Windows or
`go build -o bin/skyview ./cmd/skyview` on Linux and macOS.

A Nix development environment is also provided in [flake.nix](flake.nix). On a host with Nix flakes
enabled, run `nix develop`, install the frontend dependencies with `npm --prefix web ci`,
then use `make build`, `make dev-api`, `make dev-web`, `make test` or `make vet`.

Container and cluster configuration is included. The [Kubernetes guide](kubernetes/README.md)
describes the existing Traefik, cert-manager, storage and registry setup; adapt its example values
and environment assumptions before deploying.

## Language support

The custom Go parser supports selected declarations, types, values, documentation, connections,
dependencies and satisfaction links. It also projects the drone example's use case, constraints,
ordered actions, event occurrences, typed messages, state ordering and verification references.
Diagnostics include unresolved references, malformed supported expressions and duplicate names.

Known boundaries include:

- Imports resolve within the parsed source, including combined model bundles. External files and
  standard libraries are not loaded automatically. Recognized library names are a finite subset:
  scalar types and selected SI mechanical quantities. The exact catalogue is in
  [quantities.go](internal/sysml/quantities.go); unit conversion and dimensional analysis are not implemented.
- Some constructs, including native `view`, `rendering`, `concern`, `alias` and `metadata`, remain
  unprojected; their source is preserved and the projection gaps are reported.
- Sequence, activity and state diagrams, constraint evaluation and verification execution are not
  implemented. The grid and inspector expose the supported behavior relationships and expressions.
- Successful parsing or display does not establish full language validity or semantic correctness.
- Satisfaction links express model relationships; their presence does not establish that a
  requirement has passed verification.

Conformance work should be assessed against the OMG SysML 2.0 and KerML 1.0 specifications [1][2].
The [HTTP API](docs/api.md) is specific to SkyView; conformance to the separate OMG Systems Modeling
API and Services specification has not been established [3].

## Project layout

| Path | Responsibility |
| --- | --- |
| `cmd/skyview/` | Application entry point |
| `internal/sysml/` | Lexer, parser, model representation, diagnostics and source edits |
| `internal/server/` | HTTP API, workspace storage, history and embedded interface |
| `web/` | React, TypeScript and Vite frontend |
| `internal/projects/` | Project directories, archive safety and Git snapshot import |
| `examples/` | Versioned, embedded example project templates |
| `workspace/` | Ignored runtime projects and legacy files |
| `architecture/` | Native project design contract and implementation map |
| `kubernetes/` | Cluster deployment configuration and guide |
| `scripts/` | Container build tooling and optional native model validation/preview helpers |

## Origins

SkyView began as an experiment created by Carl Maier with assistance from a locally hosted language model,
inspired by a demonstration of SysON. Its continued development aims to combine approachable visual
modeling with dependable SysML v2 support.

## License

[MIT](LICENSE), copyright (c) 2026 Carl Maier and Viktor Ingre.
Bundled dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).

## References

1. OMG, [SysML 2.0](https://www.omg.org/spec/SysML/2.0).
2. OMG, [KerML 1.0](https://www.omg.org/spec/KerML/1.0).
3. OMG, [Systems Modeling API and Services 1.0](https://www.omg.org/spec/SystemsModelingAPI/1.0).
