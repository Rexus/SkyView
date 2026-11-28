"""Exercise the version rules and the signed main/tag transaction against a disposable remote."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from version import next_version, release_intent


class VersionRules(unittest.TestCase):
    def test_release_intent_and_next_version(self):
        for branch, title, expected in [
            ("feature/diagram", "fix: title loses to branch", "v0.3.0"),
            ("codex/feat/diagram", "", "v0.3.0"),
            ("bug/zoom", "", "v0.2.1"),
            ("codex/fix/zoom", "", "v0.2.1"),
            ("hotfix/zoom", "", "v0.2.1"),
            ("v1.0", "", "v1.0.0"),
            ("codex/release/v1.0.0-beta.1", "", "v1.0.0-beta.1"),
            ("codex/v0.3-workbench", "feat(ui): workbench updates", "v0.3.0"),
            ("docs/contributing", "docs: update guide", None),
        ]:
            with self.subTest(branch=branch):
                intent = release_intent(branch, title)
                self.assertEqual(next_version("v0.2.0", intent) if intent else None, expected)

    def test_version_must_advance_in_semver_order(self):
        self.assertEqual(next_version("v1.0.0-rc.9", "v1.0.0-rc.10"), "v1.0.0-rc.10")
        self.assertEqual(next_version("v1.0.0-rc.10", "v1.0.0"), "v1.0.0")
        for target in ["v1.0.0", "v0.9.9", "v1.0.0-rc.1", "v1.1.0-beta.01", "v01.0.0"]:
            with self.subTest(target=target), self.assertRaises(ValueError):
                next_version("v1.0.0", target)


class SignedRelease(unittest.TestCase):
    def test_main_stamp_and_failed_tag_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.exercise(Path(tmp))

    def exercise(self, tmp):
        remote, work, keyring = [tmp / name for name in ("remote.git", "work", "keyring")]
        keyring.mkdir(mode=0o700)
        work.mkdir()
        env = {
            **os.environ, "GNUPGHOME": str(keyring), "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "SkyView test", "GIT_AUTHOR_EMAIL": "release@example.org",
            "GIT_COMMITTER_NAME": "SkyView test", "GIT_COMMITTER_EMAIL": "release@example.org",
        }

        def run(*args, check=True):
            result = subprocess.run(args, cwd=work, env=env, text=True, capture_output=True)
            if check and result.returncode:
                self.fail(f"{args[0]} {args[1]} failed: {result.stderr}")
            return result

        def git(*args):
            return run("git", *args).stdout.strip()

        def stamp(pr, revision, intent, check=True):
            return run("bash", "deployment/release/stamp-main.sh", str(pr), revision, intent, check=check)

        run("gpg", "--batch", "--pinentry-mode", "loopback", "--passphrase", "",
            "--quick-generate-key", "SkyView test <release@example.org>", "ed25519", "sign", "1d")
        keys = run("gpg", "--batch", "--with-colons", "--list-secret-keys").stdout
        env["SKYVIEW_RELEASE_FINGERPRINT"] = next(line.split(":")[9] for line in keys.splitlines()
                                                   if line.startswith("fpr:"))
        try:
            git("init", "--bare", "--initial-branch=main", str(remote))
            git("init", "--initial-branch=main")
            scripts = work / "deployment/release"
            scripts.mkdir(parents=True)
            for script in ("stamp-main.sh", "version.py"):
                shutil.copyfile(Path(__file__).parent / script, scripts / script)
            (work / ".version").write_text("v0.2.0\n", encoding="ascii")
            git("add", ".")
            git("commit", "-m", "Existing main with missing v0.2.0 tag")
            baseline = git("rev-parse", "HEAD")
            git("remote", "add", "origin", str(remote))
            git("push", "origin", "main")
            stamp(10, baseline, "minor")
            version_commit = git("-C", str(remote), "rev-parse", "main")
            self.assertEqual(git("show", f"{version_commit}:.version"), "v0.3.0")
            self.assertEqual(git("diff", "--name-only", baseline, version_commit), ".version")
            self.assertEqual(git("rev-parse", "v0.3.0^{commit}"), version_commit)
            git("verify-commit", version_commit)
            git("verify-tag", "v0.3.0")
            stamp(10, baseline, "minor")
            self.assertEqual(git("-C", str(remote), "rev-parse", "main"), version_commit)

            hook = remote / "hooks/pre-receive"
            hook.write_text("#!/bin/sh\nwhile read -r old new ref; do\n"
                            '  if [ "$ref" = refs/tags/v0.3.1 ]; then exit 1; fi\n'
                            "done\n", encoding="ascii")
            hook.chmod(0o755)
            self.assertNotEqual(stamp(11, version_commit, "patch", check=False).returncode, 0)
            pending = git("-C", str(remote), "rev-parse", "main")
            self.assertEqual(git("show", f"{pending}:.version"), "v0.3.1")
            self.assertEqual(git("ls-remote", "origin", "refs/tags/v0.3.1"), "")
            hook.unlink()
            stamp(11, version_commit, "patch")
            self.assertEqual(git("-C", str(remote), "rev-parse", "main"), pending)
            self.assertEqual(git("rev-parse", "v0.3.1^{commit}"), pending)
            self.assertNotEqual(stamp(12, pending, "v0.2.0", check=False).returncode, 0)
            self.assertNotEqual(stamp(12, "0" * 40, "patch", check=False).returncode, 0)
        finally:
            run("gpgconf", "--kill", "gpg-agent")


if __name__ == "__main__":
    unittest.main()
