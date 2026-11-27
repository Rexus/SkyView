# SkyView project guidance

Follow the user's canonical personal guidance first. This file records SkyView-specific decisions.

- [Deployment options](deployment/README.md) own local Go, Docker/Podman and hosted Kubernetes startup.
  Hosted SkyView uses authenticated account workspaces on one persistent volume. Keep credentials outside Git.
- [Build identity and releases](CONTRIBUTING.md) use the root `.version` and signed main-history tags.
  Keep application build, model revision and native SysML checker identities distinct.
- [Standards and validation](docs/standards.md) owns the authority order, pinned release, native lint
  workflow and conformance limits. OMG specifications govern SysML/KerML meaning; the official
  Systems-Modeling release supplies libraries, grammar and reference examples. Do not invent language
  rules or weaken models to satisfy SkyView's partial rendering parser.
- [Viewer design reference](docs/viewer-design.md) records Tom Sawyer SysML v2 Viewer as the reference
  for design, appearance and interaction. Implement original SkyView code and assets; do not introduce
  its commercial SDK or copy branding. Follow OMG meaning when presentation examples differ.
- Native `.sysml` / `.kerml` files own model semantics. Project view JSON owns selection, placement and grouping; hiding an element in a view must not delete it from source.
- Every parser/semantic-edit change needs a native-valid positive example and a meaningful negative
  control. Run the existing Go/web checks and `skyview lint -repository -timeout 5m`; retain the report for the
  current attempt. A native pass is evidence for that release and snapshot, not OMG certification.
- Builds use `SYSML_CHANNEL=published` by default, `latest` for an explicit preview opt-in and
  `locked` for offline reproduction. `standards-update` records the selected official release in
  `internal/standards/release.json`; verify that identity against installed artifacts before reporting it.
  Keep downloaded upstream sources, libraries and binaries in ignored build/cache directories, never Git.
  Never silently ignore validator failures, unsupported projections, missing tools or failed checks.
- Use one interactive diagram canvas and native node components for automatic and saved views.
  The tool/view configuration is the visual authority; SVG is derived output. Never introduce a
  separate whole-SVG viewer or duplicated drawing/model logic for saved layouts. Browser node/edge
  glyphs and full SVG exports must use the same backend drawing definitions and effective view.
  Preserve portable project boundaries. User-account-bound
  Git commits/pushes remain a future distributed capability; current imports are snapshots.
- [Custom diagram views](docs/shared-presentation.md) live inside Diagram alongside the automatic
  model diagram. Sharing is a property of the saved view format, not a separate diagram category.
  Diagram is the main stage; Projects, Model elements and Settings live on the left. Element reuse
  changes view selection, not semantic identity. Only resolved authored relationships get arrows.
  The Settings keyword palette is shared by all diagram views and SVG output. Custom views own
  selection, placement, and grouping only. Ignore imported legacy artwork fields when drawing;
  all views use the same native cards, labels, ports, and colour rules.
  The presentation guide owns portable boundary and layout behavior.
  Arrange unlocked containers from the inside out; locked interiors move as a unit. Preserve the
  ordinary Diagram layout. Keep annotation membership separate from native ownership and never
  silently replace a source relationship with a presentation-only connector.
