# Model exchange and shared views

[README](../README.md) · [HTTP API](api.md) · [Local development](local-development.md)

SkyView preserves imported UTF-8 `.sysml` source, including constructs its parser cannot yet
project. Import/export is a source-file round trip, not proof of complete SysML support or
safe bidirectional graphical editing. Keep the project's native validator as the conformance gate.

For a directory containing several models and supporting files, use [project ZIP import/export](projects.md).
CLI `import` and `export` accept `-project ID` to address a selected project and `-name models/Plant.sysml`
for nested paths. Without `-project`, existing legacy-workspace behavior is retained.

## Contents

- [Exchange source](#exchange-source)
- [Share one repeatable view](#share-one-repeatable-view)
- [Automate checks](#automate-checks)
- [Current boundaries](#current-boundaries)

## Exchange source

Build from the SkyView repository root. Commands below use a Linux shell; Windows-native builds
use `bin/skyview.exe`. With AlmaLinux WSL, prefix each Linux command with
`wsl -d AlmaLinux-10 --exec` from PowerShell and use Linux paths for its file arguments.

```sh
go build -o bin/skyview ./cmd/skyview
./bin/skyview -addr 127.0.0.1:8081 -workspace ./workspace
```

In another terminal, import a native-validated model and download it to a new file:

```sh
./bin/skyview import -in /path/to/Model.sysml
./bin/skyview export -name Model.sysml -out /path/to/Export.sysml
./bin/skyview inspect -in /path/to/Export.sysml
```

Use `-url` to select a different server. An identical repeat import succeeds; a different source
with the same workspace filename is refused. Export refuses to overwrite an existing output.
For a changed Git revision, use a new workspace name with `-name`, or explicitly review and replace
the existing workspace source through the app. Imports with explicit empty content stay empty;
only creation without a `content` property inserts the starter model.

Exported graphical/source edits are proposals: compare them against the original import, reconcile
them into the owning Git files, run native validation and project checks, then publish a new revision.
SkyView does not split a combined model back into its original repository files or reconcile edits.

## Share one repeatable view

A versioned JSON sidecar owns **selection and layout only**. Nodes and edges refer to unambiguous
native short names, or fully qualified names as shown in the parsed model. Labels and relationship
meaning come from `.sysml`. A short name must be unique across the imported bundle to select by it.

```json
{
  "version": 1,
  "views": [{
    "id": "system-overall", "title": "System Overall", "owner": ".", "subject": "SYS",
    "width": 600, "height": 250,
    "nodes": [
      {"element": "A", "x": 30, "y": 80, "width": 180, "height": 90},
      {"element": "B", "x": 390, "y": 80, "width": 180, "height": 90}
    ],
    "edges": [{
      "element": "D", "from": "A", "to": "B",
      "points": [[210, 125], [390, 125]], "label": [300, 110]
    }]
  }]
}
```

This configuration expects native parts `A` and `B` and a native dependency `D` from `A` to `B`
inside subject `SYS`. `owner` is `.` for the whole system, or a relative subsystem/component path.
Organize all concerns under their subject owner; do not make an automatic view for every model file.
Changing coordinates does not create model parts or relationships.

```sh
./bin/skyview render -in /path/to/Model.sysml -views /path/to/Model.views.json \
  -view system-overall -out /path/to/SystemOverall.svg
./bin/skyview import -in /path/to/Model.sysml -views /path/to/Model.views.json
./bin/skyview export -name Model.sysml -out /path/to/Export.sysml \
  -views-out /path/to/Export.views.json
```

The workspace stores the sidecar as `Model.views.json`, beside `Model.sysml`. Commit both inputs
in their owning repository; copy or import both on another machine. In SkyView open **Shared views**.
The selected view is shareable at `/?file=Model.sysml&view=system-overall`. The recipient needs that
same model and sidecar in their server workspace. **Download SVG** uses the same bytes as CLI render.
The normal Diagram tab remains the interactive automatic layout; it is not this published selection.

The renderer rejects unknown/ambiguous selections, mismatched or reversed dependency endpoints,
overlapping boxes and detached/non-orthogonal edge routes. Invalid selections return an error rather
than an old diagram. Version 1 pins the renderer's logical-design palette and text style; no browser
layout engine or remote assets are needed. Output metadata records source and view hashes.

## Automate checks

```sh
go test -timeout 90s ./cmd/... ./internal/...
go vet ./cmd/... ./internal/...
./bin/skyview render -in /path/to/Model.sysml -views /path/to/Model.views.json \
  -view system-overall -out /path/to/SystemOverall.svg -check
```

`render` works offline. `-check` exits nonzero if the committed SVG is stale or the selected view
cannot resolve; it never rewrites the file. `inspect` produces JSON diagnostics but deliberately
does not present a tolerant parse as native validation. A successful inspect exit means the input
was read, not that the full model conforms to SysML.

The tests exercise the real HTTP storage layer, exact UTF-8/CRLF/empty-source preservation, repeat
import, conflict/overwrite refusal, config exchange, browser/CLI SVG equality, stale output and
invalid relationships. GitHub Actions and GitLab CI run the Go checks and build the interface.
An external project's real-model/native-parser acceptance remains in that project; the homelab
integration is exercised there without copying its semantic source into this repository.

## Current boundaries

- Source exchange accepts UTF-8 files up to 16 MiB; assemble cross-file imports with the project's
  native build first. SkyView does not load the complete SysML standard library or resolve an arbitrary
  multi-file project itself.
- Shared rendering currently supports part/package boxes and binary dependency arrows. Other
  language elements remain in source; they are not silently substituted with invented diagram elements.
- Use cases, functions, sequences, verification, ports/connectors, nesting and tier/zone annotations
  are not yet implemented by this shared renderer. Existing project SVGs remain the reader path.
- Shared-view editing is through reviewed JSON today, not drag-and-drop persistence. The sidecar is
  stored separately from the source; import validates it before source creation and reports a partial
  publication if the subsequent sidecar write fails. Exporting a live changing model is not a transaction.
- Pin a SkyView commit/release for repeatable automation. Changing the renderer version may intentionally
  change SVG bytes; review and regenerate outputs together. No automatic deployment is enabled.
