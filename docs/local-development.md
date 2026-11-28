# Work with a local SkyView installation

[Back to the README](../README.md) · [Deployment options](../deployment/README.md)

Start SkyView [with Go](../deployment/go/) or [with Docker or Podman](../deployment/docker/).

## Source validation

Open a model's **Source** tab or choose **Split** to see source beside the current diagram.
Drag the divider to resize the panes, or focus it and use the arrow keys. Select an element
in the diagram to reveal its declaration. Moving the caret within a saved declaration highlights
that element or its visible owner in the diagram. Save source edits to refresh the diagram and
resume linked navigation. The editor's 80-column ruler is a visual guide.

SkyView checks the current draft after a short typing pause.
**Quick check** checks it immediately with the partial rendering parser. **Native check** uses the pinned
official release across the project.

- Errors and warnings underline the affected text and appear in the gutter and scrollbar overview.
- Hover over the marked text or gutter marker for the reason and a suggested fix when available.
- Click a diagnostic row or scrollbar marker to select its exact source range. **F8** moves to the next diagnostic;
  **Ctrl+Shift+M** (macOS: **Cmd+Shift+M**) opens CodeMirror's diagnostic panel.
- Editing clears outdated highlights immediately. Results from earlier drafts or another file/project
  cannot replace current results. A connection failure is shown as **Validation unavailable**.

Suggestions are review guidance; SkyView does not apply them automatically. Its parser supports a
subset of SysML v2, so an unresolved library reference can be a tool limitation. Keep the project's
native SysML validation as the conformance gate. Opening a CRLF file does not mark it as edited;
source editing uses LF line endings when saved.

![Unsaved source warning with an exact underline, gutter marker and suggested fix](images/skyview-source-warning.jpg)

The HTTP diagnostic format is described in [the API reference](api.md#source-diagnostics).
Frontend regression tests cover ranges, hover content, draft changes and validation failures.
Run them from `web/` with `npm test`; GitHub and GitLab CI use the same command.

## Data and recovery

The native app's `./workspace` and the container's named volume are separate workspaces.
Use **Export project** and **Projects → Upload ZIP** to move models, views, layouts and assets between
them. Copy the entire workspace when you also need revision history. Back up any separately configured
local project folders too; they are not copied into the workspace.

For a container backup, stop SkyView and copy its workspace to a new local directory:

```sh
docker stop skyview
docker cp skyview:/data ./skyview-backup
docker start skyview
```

Use the equivalent `podman` commands for a Podman container. To inspect a backup with the native app,
run `go run ./cmd/skyview -addr 127.0.0.1:8081 -workspace ./skyview-backup` after stopping any other
SkyView process on port 8081.

The History dialog can restore saved model snapshots. Deleting a model in the UI also deletes its
history and layout, so retain independent backups. Removing the named volume deletes all its data.

If startup fails, check the logs and whether port 8081 is already in use. For a native workspace,
check that your account can write to the selected directory. For containers, use a fresh named volume
or ensure an existing one is writable by the container user.

The local deployment uses single-user mode. Use the [CaaS deployment](../deployment/caas/) for a shared host.

## Official native checker

Install JDK 21+ alongside Go, then run `go run ./cmd/skyview standards-setup`. The source editor's
**Native check** uses the official pinned pilot and complete project sources; **Quick check** uses
SkyView's partial rendering parser. The default Docker/Podman image includes the native toolchain.
See [native validation](standards.md) for WSL setup, CLI lint, CI gates, configuration, version limits
and the optional smaller Go-only container target.
