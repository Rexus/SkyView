# Contributing to SkyView

[Project overview](README.md) · [Development setup](README.md#development) · [Deployment options](deployment/README.md)

Make changes on a branch and open a pull request against `main`. GitHub requires a pull request to
update `main` and blocks force pushes and deletion. Read **Check and build** before merging.
Explain behavior changes and include the checks and evidence that apply. Keep downloaded standards
and generated local checker artifacts outside Git.

## Refresh the README screenshot

For a push that includes a README screenshot refresh, use the bundled example in light mode.
Capture the build you are pushing and record its date, app version and revision in the caption.
Follow the [drone screenshot steps](docs/drone-example.md#readme-screenshot).

## Report a bug

Select the app version in the footer and choose **Copy build report**. Include it with the steps to reproduce,
the expected result and a project ZIP or minimal model if you can share it. The report includes the build,
deployment mode, SysML checker identity and selected model revision. Review any project data separately
before attaching it. From a terminal use `skyview version -json` to identify the executable.

## Cut a release from main

1. Update the root `.version` in a pull request. Use a SemVer tag such as `v0.2.0`, `v0.2.0-beta.1` or
   `v0.2.0-rc.1`. Prereleases use GitHub's prerelease flag. Leave SemVer build metadata out of the tag
   so it can also serve as an OCI image tag.
2. Merge the pull request, update your checkout of `main` and confirm that it contains that version.
   Create an annotated, signed tag for that commit and push the tag. Register the signing key with
   GitHub so the tag receives a verified signature.
3. **SkyView release** verifies the signature, matches the tag to `.version`, and checks that the tagged
   commit is in `main`. It runs the regular Go, web, simulation and native SysML checks before publishing.
   The workflow publishes Linux and Windows amd64 archives and a Linux amd64 OCI image, with checksums
   and signed GitHub build provenance. Release notes include the immutable image digest. The release
   uses the committed SysML lock. The workflow leaves version changes to the pull request path.

GitHub Container Registry may initially give the package private visibility. Set the linked
`skyview` package to public after the first publication for anonymous image pulls.
Use the release's digest when deploying and verify the archive or image with
`gh attestation verify … -R Rexus/SkyView`. The app's **Official** label reflects embedded packaging
metadata. Use artifact attestation to verify the publisher.

## Build identity

`.version` is the portable base version, even in source archives or shallow checkouts. Native Go builds
read any available revision from Go's build metadata. The [container build script](deployment/docker/)
copies the available Git revision and source state into the binary and its OCI labels. Ordinary
checkout builds and rebuilds from a source archive display **Unofficial build**. The report explicitly
identifies an unknown revision when Git metadata is unavailable.

For a modified development build, retain the source archive or patch alongside the build report.
Its recorded commit and binary hash identify the build but cannot reconstruct uncommitted changes.
The model revision and the installed SysML standard have their own fields.
