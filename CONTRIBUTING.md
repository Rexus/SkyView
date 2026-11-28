# Contributing to SkyView

[Project overview](README.md) · [Development setup](README.md#development) · [Deployment options](deployment/README.md)

## Branch and pull request workflow

Start from the current upstream `main` and make changes on a branch.

- Repository collaborators with write access can create and push their branch in `Rexus/SkyView`.
- Other contributors should fork `Rexus/SkyView` and push their branch to their fork.

Open a pull request targeting `Rexus/SkyView:main`. Explain what changed and include the checks
and evidence that apply. Keep discussions constructive and focused on the work.
Before squash merging, update the branch from `main`, resolve review conversations and wait for
all three **Check and build** jobs to pass (`check`, `pendulum` and `sysml`).
GitHub blocks force pushes and deletion on `main`. A maintainer approves workflow runs for
first-time fork contributors.

Keep downloaded standards and generated local checker artifacts outside Git.

## Refresh the README screenshot

For a push that includes a README screenshot refresh, use the bundled example in light mode.
Capture the build you are pushing and record its date, app version and revision in the caption.
Follow the [drone screenshot steps](docs/drone-example.md#readme-screenshot).

## Report a bug

Use the [security policy](SECURITY.md) for a suspected vulnerability.
Use the [issue chooser](https://github.com/Rexus/SkyView/issues/new/choose) for an ordinary bug.

Select the app version in the footer and choose **Copy build report**. Include it with the steps to reproduce,
the expected result and a project ZIP or minimal model if you can share it. The report includes the build,
deployment mode, SysML checker identity and selected model revision. Review any project data separately
before attaching it. From a terminal use `skyview version -json` to identify the executable.

## Version and release workflow

Choose a branch name that describes the expected release. A `codex/` prefix works with each rule.

| Branch example | Result from `v0.2.0` |
| --- | --- |
| `feature/split-view` or `codex/feat/split-view` | Minor release `v0.3.0` |
| `fix/diagram-fit`, `bug/diagram-fit`, `bugfix/diagram-fit` or `hotfix/diagram-fit` | Patch release `v0.2.1` |
| `v1.0` or `release/v1.0.0` | Exact release `v1.0.0` |
| `release/v1.0.0-beta.1` | Exact prerelease `v1.0.0-beta.1` |

With other branch names, a PR title starting with `feat:` or `fix:` selects a minor
or patch release. Other merges leave the version alone. Exact versions must advance
the version in `.version`. Leave that file for the release workflow to update.
For a dependency fix that should ship as a patch release, use a `fix:` pull request title.

After the PR merges into `main`, GitHub Actions updates `.version` and signs the version commit
and tag. The tag starts the release checks and publication. Maintainers can follow the
[release setup and recovery guide](docs/maintainer-releases.md).

## Build identity

`.version` is the portable base version, even in source archives or shallow checkouts. Native Go builds
read any available revision from Go's build metadata. The [container build script](deployment/docker/)
copies the available Git revision and source state into the binary and its OCI labels. Ordinary
checkout builds and rebuilds from a source archive display **Unofficial build**. The report explicitly
identifies an unknown revision when Git metadata is unavailable.

For a modified development build, retain the source archive or patch alongside the build report.
Its recorded commit and binary hash identify the build but cannot reconstruct uncommitted changes.
The model revision and the installed SysML standard have their own fields.
