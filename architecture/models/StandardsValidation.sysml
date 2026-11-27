package StandardsValidation {
    doc /* SkyView validation boundary. Published OMG specifications govern language meaning;
        the official release supplies pinned libraries, examples and a version-matched pilot checker.
        Tom Sawyer Viewer guides the presentation, never language semantics.
        Native checking does not establish complete language, graphical or API conformance. */
    private import ScalarValues::*;
    part def ValidationRun {
        attribute toolchainVerified : Boolean;
        attribute completeSnapshotChecked : Boolean;
        attribute originalSourcesPreserved : Boolean;
        attribute failuresReported : Boolean;
        attribute evidenceMatchesInputs : Boolean;
        attribute versionMatchesInstalledInputs : Boolean;
        attribute previewRequiresOptIn : Boolean;
    }
    part def ProjectSnapshot {
        doc /* Collect bounded UTF-8 SysML/KerML sources within one project, with a draft overlay
            when checking an unsaved browser document. Do not combine independent projects. */
    }
    part def OfficialChecker {
        doc /* Run the pinned pilot with official release libraries in an isolated Java process.
            Parse and index all project files before validating. No model behavior execution.
            Time out, cancel and bound concurrent processes; failures never become a clean result. */
    }
    part def ValidationService {
        part sources : ProjectSnapshot;
        part checker : OfficialChecker;
        doc /* Shared Go capability used by the application and CLI/CI. Return source hash,
            release provenance and per-file diagnostics. The existing Go parser supplies only
            a partial rendering projection. Its findings remain separately identifiable. */
    }
    part service : ValidationService;
    dependency checkProject from ValidationService::sources to ValidationService::checker;
    package Intent {
        requirement reproducibleInputs {
            subject run : ValidationRun;
            doc /* SV-01: Every reported native result shall identify its release and exact
                source snapshot, using checksum-verified official validator and library inputs.
                The footer and machine-readable identity shall distinguish a verified installed release
                from a missing or mismatched installation. The lock and adapter hashes identify the build. */
            require constraint { run.toolchainVerified and run.evidenceMatchesInputs and run.versionMatchesInstalledInputs }
        }
        requirement publishedBuildDefault {
            subject run : ValidationRun;
            doc /* SV-05: Normal builds shall select an explicitly published OMG language baseline.
                Preview standards require the latest channel; locked builds use the recorded release offline.
                Downloads remain local build outputs, while only their identity lock is source-controlled. */
            require constraint { run.previewRequiresOptIn }
        }
        requirement projectSemantics {
            subject run : ValidationRun;
            doc /* SV-02: Native validation shall resolve the selected project's complete source
                snapshot without leaking declarations from a previous or sibling project. */
            require constraint { run.completeSnapshotChecked }
        }
        requirement preserveSource {
            subject run : ValidationRun;
            doc /* SV-03: Validation shall preserve saved source files and shall not save a draft. */
            require constraint { run.originalSourcesPreserved }
        }
        requirement honestOutcome {
            subject run : ValidationRun;
            doc /* SV-04: Missing or changed tools, timeout, invalid source and checker failure
                shall not be reported as a passing native check. Edited drafts invalidate displayed evidence.
                Findings inherited from official libraries remain visible separately; strict-library mode
                also fails the result on those dependency defects, without modifying release files. */
            require constraint { run.failuresReported }
        }
    }
    package Scenarios {
        use case checkDraft {
            subject system : ValidationService = service;
            objective { doc /* Open a project, edit without saving, explicitly run the official
                checker, inspect per-file messages, correct a defect and rerun. */ }
        }
        use case buildWithStandard {
            subject system : ValidationService = service;
            objective { doc /* Choose published, latest or locked. Resolve and checksum-pin the official
                release, build SkyView with that lock, install matching tools locally, and display their
                verified identity in the footer. Failure must not silently substitute another release. */ }
        }
        use case gateRelease {
            subject system : ValidationService = service;
            objective { doc /* Install verified release tools; check all first-party model projects,
                all pinned unmodified official example projects and negative controls. Retain the newest report,
                including failed attempts. Use the same gate locally, in GitHub and in GitLab. */ }
        }
        verification buildSelection { subject run : ValidationRun; objective { verify Intent::publishedBuildDefault; } }
        verification provenance { subject run : ValidationRun; objective { verify Intent::reproducibleInputs; } }
        verification crossFileIsolation { subject run : ValidationRun; objective { verify Intent::projectSemantics; } }
        verification sourceIntegrity { subject run : ValidationRun; objective { verify Intent::preserveSource; } }
        verification failureCases { subject run : ValidationRun; objective { verify Intent::honestOutcome; } }
    }
}
