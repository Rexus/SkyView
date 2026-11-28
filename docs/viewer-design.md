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

The reference uses a compact model tree and properties panel beside a large diagram canvas, with
nested compartments, fine connectors and restrained colors. Its documented interaction includes
selective expansion, tree/nested structures, automatic orthogonal layouts and sequence views. [1]

For SkyView, retain readable light/dark themes, a persistent project identity and a large canvas.
Use model-kind labels, visible selection/focus, compact contextual controls and consistent role colors.
Diagram opens first and remains the main work area. Choose the automatic layout or a saved view
from one **Diagram view** picker. Both use the same glyphs, project language colours and compact
viewport controls for selecting, panning, zooming and fitting. Model diagrams arrange and fit
when opened or when the scope or projection changes. Dragging stores manual positions for that
scope and projection. Use **… → Restore saved positions** to revisit them. Saved views open
with their saved geometry. **Auto layout** fits the arranged diagram to the available canvas.
A thin titled frame follows the
canvas and identifies the displayed scope. Presentation boundaries inside the frame group selected
elements. The left navigator holds **Projects**, **Elements** and **Settings**, with properties
below. Put actions beside the selector they affect. Use **+** to add an item and **…** for settings
and other actions. Reuse the same button, menu, tooltip and dialog behavior wherever these controls
appear. The sidebar toggle sits where the navigator meets the view toolbar. When the sidebar is
hidden, use the same button at the left edge of the view. **Ctrl+B** (**Cmd+B** on macOS) also
toggles it, and SkyView remembers your choice. **Undo** and **Redo** sit beside the toggle. Expand a file in the project map
to find its packages and views. Choose **Grid**,
**Requirements** or **Source** beside **Diagram** to work with the same model in the main area.
**Split** puts source and the selected diagram side by side and links their selection for saved source.
The editor provides an 80-column ruler and a clickable diagnostic overview beside the scrollbar.

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
