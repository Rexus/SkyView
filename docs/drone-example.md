# Explore the inspection drone

[Back to SkyView](../README.md) · [Native model](../workspace/InspectionDrone.sysml)

This fictional inspection quadcopter is a small, connected example for exploring SkyView and finding
gaps in its SysML v2 support. A pilot uploads a waypoint mission, the vehicle captures an image, and
then returns. PX4's mission, return and failsafe documentation provides the domain context [1–3].
The 20% battery threshold and 3-second link timeout are **invented demonstration choices**, not PX4
defaults, regulatory limits or a complete aircraft design.

## Open it

Start SkyView from the repository root using the [local run guide](local-development.md), then select
`InspectionDrone.sysml` in the model selector. It lives in the default `workspace/` directory.

For an existing Docker/Podman volume or a different workspace, use **Import** in the top toolbar and
choose `workspace/InspectionDrone.sysml` from your checkout. The container's empty-workspace seed
remains the original example. Import under a different name if you already have an edited drone model.
Make a copy before experimenting; editing the default workspace file also changes your Git checkout.

1. Open **Diagram**, select scope **InspectionDrone::Drone**, and use **Interconnection**.
   Five subsystem nodes and four links show navigation, battery, controller, camera and propulsion.
2. Switch to **Containment** to explore ownership. Select **InspectionDrone::InspectionSystem** for
   the ground station, drone and external pilot role. The current diagram does not distinguish
   reference ownership graphically; `ref part pilot` is an external role in the source.
3. Open **Requirements**. The four obligations have satisfaction links to the drone. **Matrix** shows
   those assertions and native required constraints. Planned verification links open the test intent;
   **no test results are recorded**.
4. Use **Grid** or the outline to inspect `Mission` and `Verification`. Select a message for its payload
   and resolved event endpoints, a constraint for its expression, or a verification reference for its
   target. Use **Source** for behavior edits that have no structured editor.

## What is modeled

| Model area | Useful coverage |
| --- | --- |
| `Components` | Item payloads, complementary input/output ports, part definitions and documentation |
| `Drone` | Five subsystem usages, four connections, a rotor-count value and observable state attributes |
| `InspectionSystem` | Ground-to-air connection, nested endpoint resolution and an external pilot reference |
| `Requirements` | Four obligations with Boolean/quantity constraints: preflight, battery reserve, link loss and image evidence |
| `Mission::inspectSite` | Human-led use case with a subject, actor and objective |
| `Mission::nominalMission` / `lostGroundLink` | Success-path and alternative activity sketches |
| `Mission::nominalSequence` | Six ordered messages, typed payloads and event endpoints on three participants bound to the design |
| `Mission::FlightLifecycle` | Nominal state sketch; detailed triggers, guards and failure transitions are intentionally absent |
| `Verification` | Four planned checks, each with a subject, native `verify` link and observable acceptance criteria |

The model owns the requirements and procedures. It supplies no autopilot implementation, simulator,
flight dynamics, detailed electrical design or executed verification verdicts. Connections express
logical connectivity; the camera and radio exchanges contain traffic in both directions even where
SkyView draws a single connection arrow.

## Mission sequence preview

[![Inspection mission sequence](images/drone-sequence.svg)](images/drone-sequence.svg)

This schematic preview is generated from the official parser's resolved model, including native
message endpoints, payload types and succession order. It is **not a SkyView sequence-diagram view**
or a claim of standard graphical notation. All arrows denote message occurrences; they do not assert
synchronous calls or execution timing. Edit the `.sysml` source and regenerate the preview.

## Current support and checks

Checked on 2026-11-27 after the parser fix. The model is unchanged (SHA-256 prefix `6ca56097`):

- The complete file and standard-library references pass the official SysML v2 pilot **2026-09.1**,
  kernel **0.63.1**, with its bundled `sysml.library`, using Java 21 [4–6]. Native review covered
  definition/usage ownership, directed port payloads, participant bindings, message ordering,
  requirement subjects, quantity typing and verification targets.
- An isolated negative copy with a nonexistent camera type is rejected by the native validator,
  including the resulting unresolved connection endpoint.
- SkyView loads the complete file with **zero diagnostics and zero unprojected constructs**, replacing
  the initial 67 false warnings. Regression tests check all five connections, four satisfaction links,
  four native constraints, six messages, twelve events, thirty-one successions and four verification
  references. Participant bindings and message payloads/endpoints resolve to their modeled identities.
- Negative tests keep missing types, members, event endpoints, ordering targets, units and verification
  targets visible. Syntax errors in supported expressions are reported rather than discarded.
- Identity-aware renames update constraints, participant bindings, message endpoints, succession and
  verification references without renaming unrelated elements with the same name. Regression tests
  cover these edits; arbitrary SysML edit safety remains outside the supported subset.
- The running Go app was checked in Codex's built-in browser: clean model, five subsystem nodes,
  four structural links, native constraints, planned verification navigation and resolved message
  endpoints. The README screenshot records that view.
- HTTP load/download preserved the source byte for byte. On a disposable copy, six renames and
  message/constraint documentation edits retained zero diagnostics; unsafe message type editing was
  rejected, and download/reimport was byte-exact. The complete edited copy also passed the same native
  validator (edited SHA-256 prefix `53307c57`), including all imports.
- Sequence, activity and state-diagram views, constraint evaluation and verification execution are
  **not implemented**. The grid and inspector expose supported expressions and relationships; use
  the generated sequence preview for the interaction picture. Parsing is not execution or full OMG
  conformance. Library recognition is limited to supported scalar types, `ISQ::DurationValue` and `SI::s`.

Try the following on a disposable copy. These are manual regression ideas, not claims that every
editing path has passed:

| Exercise | Check |
| --- | --- |
| Change `rotorCount` in the grid | Source changes at the intended attribute; undo/redo restores the value |
| Move diagram nodes, then reload | Layout persists without changing the SysML source |
| Edit requirement documentation | Text updates in cards and source; the satisfaction link remains intact |
| Save source, download, then re-import | Compare the full text, especially behavior and constraint bodies |
| Break a connection endpoint on the copy | A diagnostic appears; restore the source and revalidate |
| Change a message endpoint or ordering | Native validation and regenerated preview reflect the change |

Revalidate the complete model with a native validator after edits. SkyView's checks are a bounded
projection, not a replacement for native SysML syntax, typing and semantic validation. Unsupported
structured field operations are disabled; the full native source remains available for editing.

## Regenerate the sequence preview

Optional tooling: Java 21, Python 3.10 or later, and the official **0.63.1 Jupyter kernel distribution**
with its standard libraries [5]. These are not dependencies for running SkyView.
Set `SYSML_JAVA` to the Java executable, `SYSML_KERNEL` to `jupyter-sysml-kernel-0.63.1-all.jar`, and
`SYSML_LIBRARY` to that distribution's `sysml.library` directory.

From the repository root in PowerShell:

```powershell
& $env:SYSML_JAVA -cp $env:SYSML_KERNEL scripts/ExportSysML.java $env:SYSML_LIBRARY workspace/InspectionDrone.sysml InspectionDrone bin/drone-native.json
if ($LASTEXITCODE -ne 0) { throw 'Native SysML validation failed' }
python scripts/render-drone-sequence.py bin/drone-native.json docs/images/drone-sequence.svg
```

`ExportSysML.java` delegates parsing, library resolution and export to the official implementation.
The renderer reads that export rather than parsing SysML text. It supports this compact linear
three-participant scenario and rejects branching, cycles, missing order and self messages instead
of guessing a picture. The SVG uses explicit colors and system fonts and needs no modeling server.
The generated preview was checked locally; GitHub rendering has not yet been checked after publication.

To refresh the README screenshot, use **Diagram → InspectionDrone::Drone → Interconnection**,
auto-layout, and adjust zoom/pan until all five nodes are visible. Capture the actual application
viewport to `docs/images/skyview-drone.jpg`; preserve visible diagnostics. The image was
captured in Codex's built-in browser at its default 1280 × 720 viewport.

## References

1. PX4, [Mission mode](https://docs.px4.io/main/en/flight_modes_mc/mission): waypoint mission context.
2. PX4, [Return mode](https://docs.px4.io/main/en/flight_modes_mc/return): recovery behavior context.
3. PX4, [Safety configuration](https://docs.px4.io/main/en/config/safety): battery and ground-link failsafe concepts.
4. OMG, [SysML 2.0 language](https://www.omg.org/spec/SysML/2.0/Language/PDF): language authority.
5. Systems Modeling, [SysML v2 pilot release 2026-09.1](https://github.com/Systems-Modeling/SysML-v2-Pilot-Implementation/releases/tag/2026-09.1): validator and bundled libraries.
6. Systems Modeling, [official training examples](https://github.com/Systems-Modeling/SysML-v2-Release/tree/master/sysml/src/training): ports, occurrences, requirements, use cases and verification syntax. The drone model is original example content; external examples are not vendored.
