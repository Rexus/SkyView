# Viewer design reference

[Back to SkyView](../README.md) · [Standards](standards.md) · [Custom diagram views](model-exchange.md)

Tom Sawyer SysML v2 Viewer is SkyView's agreed reference for appearance and interaction, reviewed
2026-11-27. This is a product direction, not a claim of feature parity or a dependency on its SDK.

## Contents

- [Visual direction](#visual-direction)
- [Sequence diagrams](#sequence-diagrams)
- [Behavior targets](#behavior-targets)
- [Acceptance journeys](#acceptance-journeys)
- [References](#references)

## Visual direction

SkyView's own identity uses a cyan hexagon around three model nodes. Use fine, right-angled
connectors that reflect the workbench's diagram routing, rather than heavy diagonal strokes.
The original [logo asset](../web/public/skyview.svg) is shared by the README, app header,
loading and empty-workspace states, build-information panel and browser icon. The header uses
the compact label **SysML v2 design tool**. The welcome and build-information areas show the
full product description below; `BrandMark.tsx` owns the shared in-app wording and logo component.
Its ink background and pale nodes keep the mark legible in
both light and dark themes; surrounding text follows the selected theme. Keep the emblem's
proportions and colours intact, with no additional tile, shadow or gradient behind it.
The opening description is **An open-source graphical design tool for SysML v2**, supported by
**Create, visualize, edit and validate system models in your browser.** Describe SkyView as a tool
for working graphically on native SysML v2 models. Diagrams, requirements tables and source editing
operate on the same model; native source owns meaning while saved views own selection and layout.
Keep the wording formal, focused on that purpose and within the documented language-support limits.
The README's logo, badges and welcoming opening take inspiration from
[SysArx's introduction](https://github.com/CodeOOf/SysArx/tree/alpha) and the screenshot-led
[eShopOnContainers front page](https://github.com/dotnet-architecture/eShopOnContainers/tree/b9aae670e6c8ef61cf30879446283fd8e56ebcf5).
[bootc](https://github.com/bootc-dev/bootc) also informs the concise purpose, honest status and
contributor entry points. Reference projects supply inspiration, not bundled artwork or claims
about SkyView's maturity.
Brand colours identify SkyView, while the project keyword palette continues to own model colours.

The preferred interface direction is **Graphite Paper**: a clean drafting table with neutral surfaces,
compact controls and restrained blue/cyan accents that belong with the SkyView name and emblem.
Light mode uses a light top bar and a warm off-white canvas; orange is not the brand accent.
The current preview baseline uses 3px control corners, 8px navigation padding and a 40px square grid.
Dark mode should retain the drawing-table character with a neutral charcoal canvas and visible grid
divisions. Explore the surface separation used in Blender, Maya and ZBrush: distinct tool panels,
lighter model cards, clear edges and restrained selection accents. Keep the SkyView blue/cyan identity.
Grid and requirements listings should explore an academic, LaTeX-like table treatment: serif headings
and prose, aligned identifiers, generous row spacing and deliberate horizontal rules. Define table
foregrounds and backgrounds together in each theme so cells and status text remain readable.
Keep text and icons readable in filled controls through hover, pressed and focus states. Selected
tabs, navigation entries and diagram elements need distinct hover feedback while retaining their
selection marker; hover must not make the current selection disappear.
Refine the remaining panel treatments against populated workspaces, menus and element properties,
checking that dark model cards remain distinct from the working area.
These choices are being explored in concept previews; they do not describe a completed app restyle.

The reference uses a compact model tree and properties panel beside a large diagram canvas, with
nested compartments, fine connectors and restrained colors. Its documented interaction includes
selective expansion, tree/nested structures, automatic orthogonal layouts and sequence views. [1]

For SkyView, retain readable light/dark themes, a persistent project identity and a large canvas.
Use model-kind labels, visible selection/focus, compact contextual controls and consistent role colors.
Diagram opens first and remains the main work area. Choose the automatic layout or a saved view
from one **Diagram view** picker. Both use the same glyphs, project language colours and compact
viewport controls for selecting, panning, zooming and fitting. **Escape** cancels an unfinished drag
or connection, returns from Pan to Select, or clears the selection. Model diagrams arrange and fit
when opened or when the scope or projection changes. Dragging stores manual positions for that
scope and projection. Use **… → Restore saved positions** to revisit them. Saved views open
with their saved geometry. **Auto layout** fits the arranged diagram to the available canvas.
Drag a box near another box's edge or centre to align it. Matching gaps display paired spacing
guides. Hold **Alt** while dragging to place a box freely.
Automatic routing takes a clear straight path between facing sides, centred on the narrower
face when it fits. Select a connector and drag its square handle between the boxes to move both
attachments onto a straight path. Hold **Alt** to adjust only that segment. Arrow keys on the
square handle make smaller adjustments. Drag a round handle to move one attachment. The arrow
keys on a round handle select a side. Attachments and segments snap to nearby alignments with a
guide. Hold **Alt** for free placement. Separate relationships leave space between arrowheads.
Connections attached to a named port keep that port.
With a connector selected, drag its label or focus the label and use the arrow keys. A dotted
leader ties a moved label to its connector. Model diagrams remember label positions by scope and
projection. In saved views, **Save views** also saves the label position and its leader appears in
the SVG export.
Model diagrams store the manual route with their positions. Choose **… → Restore saved positions
and routes** to reuse that layout. In saved views, use **Save views** to publish route edits.
A thin titled frame follows the
canvas and identifies the displayed scope. Presentation boundaries inside the frame group selected
elements. The left navigator holds **Projects**, **Elements** and **Settings**. Selecting a part
or connector opens its properties over the right side of the view. Click the empty canvas or
**Close properties** to clear the selection. **Dock properties** keeps the panel beside the view
while an element is selected and gives it its own space. Put actions beside the selector they affect. Use **+** to add an item and **…** for settings
and other actions. Reuse the same button, menu, tooltip and dialog behavior wherever these controls
appear. The sidebar toggle sits where the navigator meets the view toolbar. When the sidebar is
hidden, use the same button at the left edge of the view. **Ctrl+B** (**Cmd+B** on macOS) also
toggles it, and SkyView remembers your choice. The sidebar slides in and out and respects the
browser’s reduced-motion setting. The diagram toolbar groups **Undo**, **Redo**,
**Save views** for saved views, and **Auto layout** beside the selector. Find **Layout properties**
under **…**. The **Overview map** starts visible and remembers your choice for the browser tab session. Expand a file in the project map
to find its packages and views. Choose **Grid**,
**Requirements** or **Source** beside **Diagram** to work with the same model in the main area.
**Split** puts source and the selected diagram side by side. With an element selected in the diagram,
**Source** and **Split** reveal and highlight its full declaration in the saved model. Moving the
caret follows the enclosing element. Properties stay closed in Source until you open them from
the editor toolbar. Use the arrows beside the line numbers to fold and expand nested blocks.
The editor also provides an 80-column ruler and a clickable diagnostic overview beside the scrollbar.
Yellow dots identify unsaved diagrams, source files, and settings in the tabs and project tree.
Source also highlights lines with unsaved edits.
**Search** opens the command palette. **Issues** lists the active model's diagnostics. Select an
issue to open its line in Source. **Notices** links to the installed version's release notes or,
for a development build, the release history. Future administrator announcements about
maintenance or downtime belong to hosted multi-user deployments.

Use **Documentation → Code** in the element inspector to edit Markdown and **Preview** to read
the rendered draft. **Save** writes the Markdown back to native SysML documentation.


**Settings → Language colours** lists SkyView's supported projected keywords as editable swatches.
The project palette applies to every model and both diagram modes. Custom views select, place and
group native elements. Both modes share cards, relationship lines and labels, toolbar styling and zoom limits.
Fit-to-view can produce different zoom levels when model extents differ.
Imported legacy appearance fields are accepted as compatibility data and have no drawing effect.

Keep source navigation close to the selected element. Colors reinforce meaning; labels and line styles
must remain understandable without color. Preserve identity while switching views and inspecting source.

Implement SkyView's own controls, icons and rendering. No Tom Sawyer logos, screenshots, code or
commercial libraries are bundled. The public product page and its illustrations were inspected; a
licensed interactive product evaluation has not been performed.

## Sequence diagrams

Use the same titled canvas and viewport controls. Draw a labeled occurrence frame for the scenario,
participant heads across the top, dotted lifelines below, and horizontal message arrows with labels
close to their lines. Participant heads use the project keyword palette. Reserve actor symbols for
participants explicitly modeled as actors. Derive message endpoints and temporal order from native
SysML occurrences, messages and successions. When ordering is partial, the diagram must preserve
that distinction. Sequence rendering remains planned.

## Behavior targets

| Reference behavior | SkyView implementation direction | Baseline status |
| --- | --- | --- |
| Tree and nested presentation | Connected navigation and scoped views of the same model identities | Partial: tree, containment and custom diagram views exist |
| Load one element, children or descendants; remove only from view | Explicit, portable selections; separate hide from semantic deletion | Model elements can add existing parts/items/packages to custom views; full contextual expansion remains planned |
| Hierarchical/orthogonal, incremental layout | Keep Auto layout; preserve saved geometry and intentional grouping | Shared layout compares layered and folded arrangements. Model diagrams reserve space for labels, and fit includes connectors and labels. |
| Ports, crossing cues and readable multi-ended relationships | Correct endpoints and relationship meaning before routing decoration | Model diagrams separate independent attachments and fan out connections sharing a native port. A small gap marks a clear crossing without a junction. N-ary relationship diagrams remain planned. |
| Sequence view with lifelines, events and messages | Derive diagrams from native occurrences and messages | Native behavior is partly projected; interactive sequence rendering remains planned |
| Consistent keyword coloring | Shared notation/palette with deliberate project overrides | Project language colours feed both diagram modes and SVG export. Settings is the only colour editor. |

The table is a design backlog, not an implementation checklist completed by this standards change.
Native semantics live in SysML. Store saved geometry beside its model and share keyword colours
through the project palette.

## Model view coverage

Start at System Overall and follow the same native element identities into focused subsystem views.
Use Logical design for responsibilities and interactions, and Solution design for selected elements and
connections. These labels describe engineering concerns. The SysML StandardViewDefinitions library
specifies General, Interconnection, ActionFlow, StateTransition, Sequence, Geometry, Grid and Browser
views and what each may contain. [2]

| View or workflow | Current coverage |
| --- | --- |
| Automatic and saved structural diagrams | Plain connections, directed flows, dashed dependencies and owner-side containment have distinct notation. Saved routes meet visible native ports. A connector to a port inside a collapsed card includes the native path. Reference usage labels preserve `ref`. |
| Saved view navigation | Shared SysML identities, view-local positions and annotation boundaries. Double-click follows a part into its saved overview or automatic scope in a tab. Project entries can open tabs from their context menu. Native `view`, `expose`, and viewpoint conditions remain open. |
| Requirements | The table shows authored IDs, projected constraints and assumptions, documentation, satisfaction assertions, and planned verification. Review flags expose gaps in the open source. Native refinement, cross-file targets, satisfaction polarity, and execution evidence have incomplete coverage. |
| Behavior and allocation | Sequence, activity, state, use-case and allocation views remain open. The drone sequence preview covers its selected scenario outside the workbench. |
| Multi-file projects | The native checker loads the whole project. The visible element and relationship projection currently resolves a single source file. An imported type or relationship can pass the native check and remain unresolved in a diagram. |

An isolated two-file model passed the pinned native checker while the projection missed a cross-file
verification reference, an implicit satisfier, a negated satisfaction assertion and a message without an
explicit payload. The official View, State, Use Case and Verification examples exercise additional known
projection gaps. Keep their source intact when filling these gaps. [2–3]

## Review requirements

Open **Requirements** for the current model file. Use the quick filter to search titles, IDs, text,
subjects, and linked cases. **All coverage** can narrow the table to missing IDs, projected
constraints, satisfaction assertions, or verification plans. Review flags describe the data available
from the model. An authored requirement can also use informal documentation. [2]

Sort by clicking a column heading. Hold Shift or use **Sort** to add a second key. Turn on **Column
filters** to search individual fields. Use **Columns** to show the subject, owner, assumptions,
satisfaction assertions, kind, or qualified name. Drag a header grip to move a column or drag its
right edge to resize it. The focused grip and resize handle also accept the left and right arrow keys.
**Export CSV** writes the filtered rows in the displayed sort and column order, including full cell text.

Select a row and use **Details** to read linked model elements and edit its Markdown documentation.
**Source** opens the declaration. **Add satisfaction link** records a SysML assertion for a requirement
usage. The **Planned verification** column links to the relevant cases and objectives. Actual verification
outcomes need separate evidence.

## Acceptance journeys

Use the inspection drone to move between structure, requirements, source and a future mission sequence
without changing model meaning. Use the inverted pendulum to follow sensing, controller and actuator
connections while preserving the cart/rail boundary and signal directions. Use the accepted Homelab
views to exercise dense nested boundaries and stable saved layouts.

For every delivered interaction, check keyboard access, readable labels, correct model selection,
project export/reimport and the corresponding offline shared rendering. Removing an element from a
view must leave its source bytes intact. Diagram frames are presentation annotations unless an actual
model element owns the represented boundary. A dependency is not automatically a signal flow.

## References

1. Tom Sawyer Software, [SysML v2 Viewer](https://www.tomsawyer.com/sysml-v2-viewer), public description
   and nested-structure illustration reviewed 2026-11-27.
2. OMG, [SysML 2.0 Part 1](https://www.omg.org/spec/SysML/2.0/Language/PDF), §7.26, §8.2.3 and §9.2.20.
3. Systems Modeling Community, [official 2026-04 examples](https://github.com/Systems-Modeling/SysML-v2-Release/tree/2026-04/sysml/src/examples).
