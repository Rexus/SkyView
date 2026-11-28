package SharedPresentation {
    private import ScalarValues::*;
    doc /* Shared presentation is separate from semantic model ownership. Native views and renderings
        define a language-level extension point; SkyView versioned JSON supplies its own bounded
        geometry, annotation and layout contract. See docs/shared-presentation.md. */
    part def Presentation {
        attribute sourceUnchanged : Boolean;
        attribute identitiesPreserved : Boolean;
        attribute geometryPreserved : Boolean;
        attribute lockedInteriorPreserved : Boolean;
        attribute pinnedPlacementPreserved : Boolean;
        attribute nativeMeaningPreserved : Boolean;
        attribute projectLanguageColoursShared : Boolean;
    }
    part def ViewEditor {
        doc /* Select native parts/items and relationships. Add annotation boundaries; drag groups,
            choose per-container Flow, Horizontal, Vertical or Grid; pin boxes relative to their
            containing layout, lock interiors; preview and save. Auto layout arranges unlocked
            interiors around pinned siblings before arranging enclosing groups. Independent
            connector attachments reserve separate positions. Moved relationship labels retain
            their placement and a leader shows which connector they identify. */
    }
    part def ViewStore {
        doc /* Versioned source-adjacent JSON owns selection, geometry and local arrangement settings.
            Model and view revision checks reject stale saves. Project bundles retain this file. */
    }
    part def Renderer {
        doc /* One renderer serves browser previews, saved views and offline SVG exports.
            Model references are resolved and checked; annotation frames do not create parts.
            Automatic and saved layouts use the same canvas and project language colours.
            Saved layouts define selected elements, placement and grouping. Colours belong to the project. */
    }
    part editor : ViewEditor;
    part store : ViewStore;
    part renderer : Renderer;
    dependency publish from editor to store;
    dependency preview from editor to renderer;
    dependency reopen from renderer to store;
    requirement preserveMeaning {
        subject presentation : Presentation;
        doc /* SP-01: Presentation editing shall leave SysML source unchanged and retain selected
            native identities, directed relationships and model-backed containment. */
        require constraint { presentation.sourceUnchanged and presentation.identitiesPreserved and presentation.nativeMeaningPreserved }
    }
    requirement portableGeometry {
        subject presentation : Presentation;
        doc /* SP-02: Exporting and reopening the same model/view files with the same renderer version
            shall preserve saved geometry/styles/settings and produce the same SVG bytes. */
        require constraint { presentation.geometryPreserved }
    }
    requirement lockedInteriors {
        subject presentation : Presentation;
        doc /* SP-03: Auto layout shall preserve a pinned box's placement relative to its container
            and arrange movable siblings around it. A boundary with only its interior locked may
            translate as a unit, preserving descendant relative coordinates, dimensions and internal routes. */
        require constraint { presentation.lockedInteriorPreserved and presentation.pinnedPlacementPreserved }
    }
    requirement commonLanguageColours {
        subject presentation : Presentation;
        doc /* SP-04: The same project language colours shall drive automatic views, saved views
            and SVG exports. Saved views shall not override native notation or project colours. */
        require constraint { presentation.projectLanguageColoursShared }
    }
    verification paletteRoundTrip { subject presentation : Presentation; objective { verify commonLanguageColours; } }
    verification roundTrip { subject presentation : Presentation; objective { verify preserveMeaning; verify portableGeometry; } }
    verification lockedGroupLayout { subject presentation : Presentation; objective { verify lockedInteriors; } }
}
