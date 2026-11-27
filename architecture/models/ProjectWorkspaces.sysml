package ProjectWorkspaces {
    doc /* SkyView project boundary. A project owns source files, view selections/layouts
        and supporting assets beneath one directory. A view is a projection within a project.
        See docs/projects.md for the implementation, limits and checked journeys. */
    private import ScalarValues::*;
    part def Project {
        attribute relativePathsPreserved : Boolean;
        attribute outsideRootAccessed : Boolean;
        attribute allFilesPublished : Boolean;
        attribute sourceRevisionRecorded : Boolean;
        attribute remoteWritten : Boolean;
        attribute modelsAndViewsExported : Boolean;
    }
    part def Browser {
        doc /* Choose project, upload ZIP, request a Git snapshot, copy an example, export for review.
            Project switching unloads drafts, diagnostics and undo state after an unsaved-edit check. */
    }
    part def ProjectCatalog {
        doc /* Catalog managed project directories and explicitly configured server-local directories.
            Legacy flat workspace remains accessible. No arbitrary server paths from browser requests. */
    }
    part def ProjectStore {
        doc /* Native files remain authoritative; preserve nested relative paths and binary assets.
            Stage bounded imports and publish only after validation; never replace an existing project.
            Reject traversal, symlinks, duplicate/case-colliding archive names and reserved internal state. */
    }
    part def SnapshotImporter {
        doc /* Public GitHub.com/GitLab.com HTTPS repositories, chosen ref and subdirectory.
            Resolve ref to a commit before downloading; retain repository/ref/commit/directory provenance.
            No credentials, hooks, checkout scripts, submodule execution, commits, pushes or automatic pulls. */
    }
    part def ExampleLibrary {
        doc /* Versioned first-party project directories embedded in native/container builds.
            Start an independent editable copy; never edit the bundled template. */
    }
    part def ModelWorkbench {
        doc /* All source, view, layout, history and download calls carry project identity.
            Nested models are browsable independently; arbitrary cross-file semantic linking is not yet implemented. */
    }
    part def WorkspaceService {
        part catalog : ProjectCatalog;
        part storage : ProjectStore;
        part snapshotImporter : SnapshotImporter;
        part examples : ExampleLibrary;
        part workbench : ModelWorkbench;
    }
    part service : WorkspaceService;
    part browser : Browser;
    dependency chooseProject from browser to WorkspaceService::catalog;
    dependency persistFiles from WorkspaceService::catalog to WorkspaceService::storage;
    dependency importSnapshot from WorkspaceService::snapshotImporter to WorkspaceService::storage;
    dependency copyExample from WorkspaceService::examples to WorkspaceService::storage;
    dependency openProject from WorkspaceService::workbench to WorkspaceService::storage;
    package Intent {
        requirement portableProject {
            subject project : Project;
            doc /* PW-01: ZIP import/export shall preserve selected source/assets and model-view
                sidecars by relative path and bytes. Saved diagram layouts travel with the project. */
            require constraint { project.relativePathsPreserved and project.modelsAndViewsExported }
        }
        requirement confinedAccess {
            subject project : Project;
            doc /* PW-02: Model and archive operations shall remain inside the selected root;
                reject traversal and symlink entries. Sibling projects shall remain unchanged. */
            require constraint { not project.outsideRootAccessed }
        }
        requirement completeImport {
            subject project : Project;
            doc /* PW-03: An imported project shall become selectable only after every accepted
                file has been persisted. A rejected or interrupted import shall not publish a partial project. */
            require constraint { project.allFilesPublished }
        }
        requirement snapshotOnly {
            subject project : Project;
            doc /* PW-04: Git imports shall record the selected commit and perform no remote writes.
                Account-bound collaborative commit/push workflows are deferred to a later distributed edition. */
            require constraint { project.sourceRevisionRecorded and not project.remoteWritten }
        }
    }
    package Journeys {
        use case uploadProject {
            subject system : WorkspaceService = service;
            objective { doc /* Upload a ZIP, choose a contained directory, open a nested model,
                edit its source/layout, export a ZIP and reopen it as a separate project. */ }
        }
        use case importRepository {
            subject system : WorkspaceService = service;
            objective { doc /* Import a public branch/tag/commit and selected subdirectory.
                Review recorded provenance; export changes for review in the repository owner workflow. */ }
        }
        use case openLocalFolder {
            subject system : WorkspaceService = service;
            objective { doc /* Operator exposes an existing directory or Git checkout at startup.
                Browser selects its named project. The directory is on the server, not the remote client. */ }
        }
        use case startExample {
            subject system : WorkspaceService = service;
            objective { doc /* Copy a bundled example into an independent project without uploading files. */ }
        }
        verification projectRoundTrip {
            subject project : Project;
            objective { verify Intent::portableProject; }
        }
        verification boundaryAndFailureChecks {
            subject project : Project;
            objective { verify Intent::confinedAccess; verify Intent::completeImport; }
        }
        verification repositorySnapshot {
            subject project : Project;
            objective { verify Intent::snapshotOnly; }
        }
    }
}
