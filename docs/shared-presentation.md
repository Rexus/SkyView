# Custom diagram views and boundary layout

[Model exchange](model-exchange.md) · [Projects](projects.md) · [API](api.md)

Custom views save a diagram's element selection, geometry, nesting and local layout choices beside
its native model. Automatic and saved views use the same interactive canvas and native node
components. One Go drawing engine supplies their individually addressable node/edge glyphs and
the offline CLI SVG export. A saved view is not a separate whole-SVG viewer. Opening a saved view
does not run auto layout; other SkyView instances display its saved geometry.

**Contents:** [Use the controls](#use-the-controls) · [Diagram workspace](#diagram-workspace) ·
[Portable format](#portable-format) ·
[Meaning and presentation](#meaning-and-presentation) · [Verification](#verification)

## Use the controls

1. Open **Diagram** and choose a saved diagram from **Diagram view**, or expand the file in **Projects**
   and open **Views**. Choose **New saved view** (+) to create a view from a native scope or open
   **Diagram actions → Import view file** to load one.
2. Shift-click sibling elements, then choose **Diagram actions → Group selected elements**. The boundary groups
   presentation elements without adding a SysML part. Drag its background to move its contents together.
3. Open **Settings → Layout properties** and select a box or group on the canvas. The panel follows
   the selection. Use **Layout target** to select another box by name or **Whole view** to edit the
   outer arrangement, title and owner folder. Choose **Flow**, **Horizontal**, **Vertical** or
   **Grid** for a container. Flow offers direction and Grid offers columns.
4. Click the top-right padlock on any box to pin or unpin it. The padlock is open and amber when
   unlocked, and closed and red when locked. A pinned box's position and size stay fixed relative
   to its containing group or the canvas. Pinned groups also preserve their contents. To preserve
   a group's interior while allowing the group to move as a unit, use **Lock contents** in the panel.
   An inherited lock stays in effect while the containing group is locked. Use **Go to locking group**
   to edit that lock. A child can also have its own placement lock.
5. **Auto layout** arranges unlocked boxes around pinned siblings, starting inside each group. It then
   sizes and arranges unlocked containers and outside elements. Flow groups connected elements, folds long chains, and favours a
   square to 4:3 canvas with fewer connector crossings and overlaps. Direction guides the reading
   order. Horizontal, Vertical and Grid still specify deliberate arrangements. **Arrange contents**
   applies the selected container
   locally, then fits its ancestors and surrounding groups while preserving peers' internal layouts.
6. Drag a box to place it. The canvas expands in any direction. A drop that overlaps another box
   or leaves its containing group returns that box to its previous position. Valid layout edits
   are autosaved to a recoverable draft. Select **Undo** in the diagram toolbar
   or press **Ctrl+Z** (**Cmd+Z** on macOS) to reverse the last layout edit in the open view,
   including Auto layout. **Redo** reapplies the change. Each view keeps its history as you switch
   diagrams or models. A new edit clears the redo steps for that view.
7. **Save views** publishes validated draft edits and sets the reset point. **Reset to last save**
   restores the published layout for the current view. Opening the model again recovers any
   autosave recorded against the current published layout.
   Undo the reset to recover the previous placement and draft. **Diagram actions** offers SVG and view JSON
   downloads. Export the project ZIP to carry the saved geometry to another instance.

While a preview is being checked, the last validated diagram stays visible with an updating message;
saving waits for the current draft to pass. Settings remain reachable through the **Layout target** selector when a draft cannot render. Error messages
identify invalid nesting, overlaps, missing identities or detached routes. A failed preview cannot
replace the saved file. Saving detects changed source and changed existing view revisions.

The **Diagram view** picker begins with **Model diagram** for the automatic layout and lists saved
diagrams beneath it. A link with `?view=` opens the named saved diagram directly. The canvas, titled
frame, native elements and shared keyword colours apply to both.

## Diagram workspace

Diagram is the initial workspace. The left navigator provides three tabs.

- **Projects** lets you switch, import and export projects and browse model files, views and packages.
- **Elements** lets you browse or search the open model and inspect its relationships and imports.
  Drag a part, item, package or requirement onto the canvas. A saved view places it near the
  drop point in open space. **Add selected to view** is the keyboard alternative for saved views.
  The model diagram positions the card in its native scope and shows that scope on drop.
  Choose another model in Projects to browse that file.
- **Settings** has **Language colours** for the project and **Layout properties** for the selected
  box or saved diagram. The diagram toolbar's **Layout properties** command opens the same panel.

Draw a connection from a real port on one part usage to a real port on another usage with the
same native owner. SkyView writes the connection into the SysML file immediately. In a saved view,
choose **Save views** to keep the resulting connector and other placement changes. Unlock a group
before adding an internal connector to its layout.

Choose **Grid** beside **Diagram** to work in the editable model table.

Selecting a native box or connector opens its [properties](viewer-design.md#visual-direction)
on the right. A presentation boundary has layout settings in the left navigator.
**Language colours** in Settings is the sole colour editor. Saving a swatch updates all diagram
views of the model and their exports. Every diagram uses native cards, names and ports. Small saved
boxes show the detail that fits using the same type sizes as automatic diagrams. Enlarge a box to
show more compartments. Group boundaries have one consistent visual style.

The palette is optional `skyview.palette.json` at the project root, included in project ZIP exports.
Use CLI `render -palette skyview.palette.json` for matching offline output when that file exists.

Source and Native check remain available. Pan/zoom, minimap and fit controls are shared. The cursor
shows an open hand for panning, move for movable nodes/frames, a closed hand during dragging,
a crosshair for connection handles and a pointer for selectable locked children. Header projection diagnostics are not native validation
results; the footer separately identifies the running official checker release and integrity.

### Open related diagrams

Double-click a part or package to open the diagram for its model identity. SkyView first looks for a
saved view of that element in the current source, then its resolved type or specialization. The view
with the shortest owner path opens as the overview. Choose from the available diagrams if several
views share that level. A part without a saved view opens its automatic model scope.

Single-click a diagram in the project tree or picker to browse it. Double-click a part to follow its
related diagram in a tab. Right-click a model, package, or view in **Projects** and choose **Open in
new tab** to keep that diagram open. The dot marks an unsaved layout. Switching tabs keeps drafts
while you work, including across source files in the same project. **Save views** saves the layouts for
that source file. **Reset to last save** restores the selected view's reset point. Right-click a tab for **Close**, **Close others**,
and **Close all**. SkyView asks before a close would discard a draft. The diagram picker and project tree
can reopen closed diagrams. Source edits in Split stay open while switching diagrams for the same file.

### Drawing and export ownership

The native model is semantic authority; the effective tool view (source plus selected IDs and
presentation configuration) is visual authority. Existing version-1/version-2 selections and coordinates
remain valid. Opening them does not regenerate them from a previously exported SVG. New views use
native compartments by default; compact captions are explicit presentation choices in existing files.

The backend resolves identities once per scene and provides individually editable node/edge drawings.
The browser binds those drawings to the common canvas's native element IDs, handles and parent groups.
It does not reconstruct a model from an SVG or redraw the same symbols using independent templates.
The same canonical drawing produces the full SVG for browser download and the CLI.

**Download SVG** exports the current validated layout draft, including unsaved colour/position changes.
It stays disabled while the draft is pending or invalid; it never silently downloads older saved geometry.
The offline CLI reads saved view configuration, so save/export that same configuration before comparing
CLI output. Pan and zoom are viewport controls and do not alter exported model coordinates. Handles,
selection outlines and settings buttons are editor controls, not exported model symbols.

## Portable format

Use `Model.views.json` beside `Model.sysml`, including inside project subdirectories. Autosave drafts
live in the project's hidden `.skyview/view-drafts/` directory and stay local to the workspace.
Version 1 supports flat selections. Version 2 adds nested placement and arrangement with
`presentation: true`. Both versions render through the same native drawing primitives.

| Field | Meaning |
| --- | --- |
| `id`, `title`, `owner`, `subject` | Stable view identity, display name, owner folder and native subject selector |
| `nodes[].element`, `edges[].element` | Unique native short name or qualified name; no duplicated semantic elements |
| `nodes[].parent` | Native container selector or annotation ID; native nesting must agree with model ownership |
| `boundaries[]` | Annotation `id`, `label`, optional `kind` (`tier`, `zone`, `network`, `group`), geometry and parent |
| `origin`, `width`, `height` | View extent. The optional `origin` coordinate pair defaults to `[0, 0]`. |
| `nodes[].x`, `nodes[].y` and boundary coordinates | Absolute positions, including nested members. Positions may be negative. |
| `layout` | Local `pattern`, `direction`, `columns`, `gap`, `padding`, `locked`, and `positionLocked`; root settings belong to the view |
| `styles` | File-level named palettes with six-digit hex `fill`, `stroke`, `color` and optional numeric `dash` |
| `nodes[].style`, `boundaries[].style` | Reference to one named palette |
| `nodes[].detail` | Native compartment card, drawn by the same definition as an automatic diagram node |
| `nodes[].shape` | `rectangle`, `cylinder` or `hexagon` presentation symbol |
| `nodes[].labels` | Optional presentation captions with box-relative `x`, `y`, `size`, `text`; native identity stays in the tooltip |
| `edges[].from`, `to`, `points`, `label` | Verified native endpoints, orthogonal route, location of the native relationship label |
| `edges[].labelMoved` | Preserves an explicitly moved label during rerouting and draws its leader in the canvas and SVG |

For example, a boundary with `"layout": {"pattern": "grid", "columns": 2, "locked": false}` arranges
its immediate members in two columns. Nested members use their own settings. `locked: true` makes
the group's current internal geometry authoritative until unlocked. `positionLocked: true` pins a
box relative to its parent and freezes its interior. A pattern change takes effect when you arrange the view.

A model can define up to 100 views. Each view can contain up to 200 native nodes, 100 annotations
and 500 edges. Canvas coordinates must be finite. Supported native nodes are parts, packages and items; supported edges
are binary dependencies, connections and projected flows. Endpoints must match the source model.
Port paths resolve to selected top-level usages; independent port symbols are not rendered here.
Use-case/actor, action, sequence and verification notation remain outside this renderer's coverage.

The CLI `render -check` checks saved output without writing. Layout calculation currently runs in
the workbench; CLI and CI render the settled geometry without a browser or layout dependency.
Old `styles`, node shapes, captions and detail flags remain readable for file compatibility. They
do not replace native notation. Changing model meaning requires a source edit and native validation.

## Meaning and presentation

SysML v2 defines view usages and renderings, including graphical renderings [1]. Its graphical
rendering library does not define these concrete coordinates, boundary grouping or local lock/grid
controls. This JSON is SkyView's versioned presentation format, not standard SysML interchange.
Future native rendering support can map it explicitly; it must preserve source identity and meaning.

Tier and network-zone boxes are annotations unless the native model actually defines a corresponding
element. Their membership does not invent composition or deployment. Actual native nesting is
checked even when annotation boxes sit between a parent and child. The project palette is a presentation resource, separate from native model components.

## Verification

[SharedPresentation.sysml](../architecture/models/SharedPresentation.sysml) owns SP-01 (source and
identity preservation), SP-02 (portable rendering) and SP-03 (container-relative pins and locked interiors) and SP-04 (shared language colours).

| Obligation | Executable checks |
| --- | --- |
| Canonical glyph/export and native-compartment parity | `TestInteractiveSceneAndExportShareDrawing`, `TestDetailedNativeNodeIsSharedWithSavedView` |
| Shared canvas geometry and semantic connection path | `web/tests/diagramScene.test.mjs` |
| Source, identity and meaning | `TestPresentationRejectsFalseMeaningAndInvalidGeometry`, `TestNativeFlowAndRedefinedMemberProjection`, `TestSharedPreviewPublicationAndConflicts` |
| Saved rendering and settings | `TestPresentationPreservesNativeContentAndPortableSettings`, server preview/publication tests, project exchange tests |
| Recursive layout and locks | `web/tests/sharedLayout.test.mjs` |
| Shared palette, isolation and export parity | `TestProjectColoursReachAutomaticSavedAndOfflineRenderers`, `TestProjectPaletteIsolatedFromSiblingProjects` |
| Settings, delayed previews, save/reopen and conflicts | `web/tests/sharedPresentation.test.mjs` |
| Diagram modes, draft protection, native reuse and palette persistence | `web/tests/diagramWorkspace.test.mjs` |
| Project-file navigation and resolved relationship direction | `web/tests/workbenchSidebar.test.mjs` |

The native model passes the pinned official checker. Application tests establish bounded presentation
behavior, not full SysML graphical conformance. Project-specific SVG migration and acceptance evidence
belong to their owning project.

## References

1. OMG, [SysML 2.0 Language Specification](https://www.omg.org/spec/SysML/2.0/Language/PDF),
   §7.26.1 (views and renderings), §9.2.19.2.5 (`GraphicalRendering`).
