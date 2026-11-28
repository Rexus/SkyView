# Maintain SkyView releases

[Contribution workflow](../CONTRIBUTING.md#version-and-release-workflow) · [GitHub Actions](https://github.com/Rexus/SkyView/actions) · [Releases](https://github.com/Rexus/SkyView/releases)

## Enable automatic releases once

1. **Create the release App.** In GitHub **Settings → Developer settings → GitHub Apps**,
   register a private App such as **SkyView Release**. Disable its webhook, give it repository
   **Contents: Read and write**, and install it only on `Rexus/SkyView`. Copy the **Client ID**
   and generate a private key for the App.
2. **Authorize the release App.** In **Settings → Rules → Rulesets**, add the App with
   **Always allow** to **SkyView main pull requests** and **SkyView release tag creation**.
   Keep repository administrators on the tag creation rule so they can sign and backfill tags.
   The two history rules have empty bypass lists. See [repository safeguards](#repository-safeguards)
   if the rulesets need to be recreated.
3. **Configure the release environment.** Open `release-versioning` in **Settings → Environments**.
   Confirm its deployment policy allows only the `main` branch. Add
   `SKYVIEW_RELEASE_APP_CLIENT_ID` as an environment variable and `SKYVIEW_RELEASE_APP_PRIVATE_KEY` as an environment
   secret. Use the Client ID and private key from step 1.
4. **Register the signing key.** Generate a dedicated OpenPGP signing key for an email verified by
   the signing GitHub account. Register the armored public key under **SSH and GPG keys** on
   that account. Add the matching email as the `SKYVIEW_RELEASE_SIGNING_EMAIL` environment variable and
   the armored private key as the `SKYVIEW_RELEASE_GPG_KEY` environment secret. The workflow
   imports a key reserved for unattended signing into a temporary keyring.
   For example, in a trusted shell with GnuPG, create a dedicated signing-only key using your
   verified email in place of `release@example.org`:

   ```sh
   gpg --batch --pinentry-mode loopback --passphrase '' --quick-generate-key \
     'SkyView Release <release@example.org>' ed25519 sign 1y
   ```

   Run `gpg --list-secret-keys --keyid-format long release@example.org` to find its full fingerprint. Use
   `gpg --armor --export FINGERPRINT` for GitHub's public key field. Export the matching
   private key with `gpg --armor --export-secret-keys FINGERPRINT` from a trusted shell and upload it
   directly to the environment secret. Keep the key out of the repository and chat.
5. **Verify the first release.** Merge a PR using one of the release branch names. In **Actions**,
   check that **Version SkyView on main** created a signed commit and tag, then check that
   **SkyView release** passed and published the same tag. If the workflow was enabled by that
   merge and GitHub did not start it, run **Version SkyView on main** on `main` with the
   merged PR number. Make the linked `skyview` package public for anonymous container
   pulls if GitHub created it as private. Confirm **Immutable releases** is enabled in repository
   settings so publishing locks assets and their tags.

## Repository safeguards

Use **Settings → Rules → Rulesets** to confirm these rules or restore them from the checked-in
definitions. Import both history rules before adding the release App to either of the other rulesets.

| Ruleset | Protection |
| --- | --- |
| [SkyView main history](../.github/main-history-ruleset.json) | Blocks force pushes and deletion on `main` for all actors. |
| [SkyView main pull requests](../.github/main-ruleset.json) | Squash PRs, resolved conversations and the three GitHub Actions checks on an up-to-date branch. After setup, only the release App can bypass this ruleset. |
| [SkyView release tag history](../.github/release-tag-history-ruleset.json) | Blocks moving and deleting `v*` tags, including for the release App. |
| [SkyView release tag creation](../.github/release-tag-creation-ruleset.json) | Allows repository admins and, after setup, the release App to create `v*` tags. |

If `release-versioning` needs to be recreated, choose **Selected branches and tags** and add
one deployment rule with **Ref type** set to **Branch** and **Name pattern** set to `main`.

Under **Settings → Actions → General**, keep the default workflow token read-only and
require approval for first-time fork workflows. The allowlist accepts GitHub-owned actions
and Docker Buildx. Keep `docker/setup-buildx-action@v4` for the historical release workflow
and `docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069` for the current one.
When updating Buildx, review the new commit and add its exact ref to the allowlist.

Under **Settings → Advanced Security**, keep private vulnerability reporting, Dependabot alerts
and security updates, CodeQL default setup, secret scanning, and push protection enabled.
The [security policy](../SECURITY.md) links to the private report form.

The version job uses the root `.version` at the current tip of `main`. When PRs merge close
together, the versioning jobs run one at a time. Each signed tag identifies the actual `main`
snapshot at the time of the version commit, which can include other already-merged changes.
Every release runs the regular Go, web, simulation and native SysML checks on that exact revision.
Published releases include Linux and Windows amd64 archives, checksums, and a Linux amd64
container built with the committed SysML lock. The workflow attests the archives and the
image digest using GitHub's signing identity, verifies the image attestation, and links the
digest from the release notes.

## Recover a failed release

1. If the version job failed, fix the error and rerun **Version SkyView on main** for that PR.
   If the signed version commit reached `main`, the job uses its existing version to create
   the missing tag. Reuse the signing key that signed the version commit.
2. If a signed tag already exists, rerun **SkyView release** from its Actions run. It can
   resume an unpublished draft and leaves published releases intact. For tags created after
   automatic versioning was added, you can also start it from the tag with GitHub CLI:

   ```sh
   gh workflow run release.yml --repo Rexus/SkyView --ref v0.3.0
   ```

   Substitute the tag to retry. Running on the tag ties the attestation to that source revision.
   If a build fails because of the source itself, fix it in a new PR and publish a new version.
3. Use the digest in the release notes to verify or deploy the image. With GitHub CLI installed,
   substitute the release digest for `sha256:DIGEST`:

   ```sh
   gh attestation verify "oci://ghcr.io/rexus/skyview@sha256:DIGEST" --repo Rexus/SkyView
   ```

   For an archive, pass its local filename in place of the OCI reference. The app's **Official**
   label shows its embedded build identity. The attestation verifies the publisher.

## Backfill the missing v0.2.0 tag

1. Fetch `main` and tags from the upstream repository. Confirm the original
   [v0.2.0 merge](https://github.com/Rexus/SkyView/commit/f56ac483f89d) contains `v0.2.0` in
   `.version` and that the tag name is free:

   ```sh
   git fetch origin main --tags
   git show f56ac483f89d:.version
   git ls-remote --tags origin refs/tags/v0.2.0
   ```

2. From the SkyView checkout, sign the tag with your registered GitHub signing key and push
   only that tag. This labels the original release commit without changing `main`:

   ```sh
   git tag -s v0.2.0 f56ac483f89d -m "SkyView v0.2.0"
   git push origin refs/tags/v0.2.0
   ```

3. Check **SkyView release** for `v0.2.0` in Actions. If a check or publication step fails, fix
   the cause and rerun that tag's workflow.
