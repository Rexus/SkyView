"""Resolve the release intent of a merged PR and apply it to .version."""

import argparse
import re


NUMBER = r"(0|[1-9][0-9]*)"
VERSION = re.compile(rf"v{NUMBER}\.{NUMBER}\.{NUMBER}(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?")


def version_key(version):
    match = VERSION.fullmatch(version)
    if not match or len(version) > 120:
        raise ValueError(f"Invalid release version: {version!r}")
    major, minor, patch, pre = match.groups()
    identifiers = pre.split(".") if pre else []
    if any(part.isdigit() and len(part) > 1 and part[0] == "0" for part in identifiers):
        raise ValueError(f"Invalid numeric prerelease identifier in {version!r}")
    ordering = tuple((0, int(part)) if part.isdigit() else (1, part) for part in identifiers)
    return int(major), int(minor), int(patch), pre is None, ordering


def release_intent(branch, title):
    branch = branch.removeprefix("codex/")
    exact = branch.removeprefix("release/")
    if re.fullmatch(rf"v{NUMBER}\.{NUMBER}", exact):
        return exact + ".0"
    if VERSION.fullmatch(exact):
        version_key(exact)
        return exact
    if re.match(r"(feat|feature)[/-]", branch):
        return "minor"
    if re.match(r"(bug|fix|bugfix|hotfix)[/-]", branch):
        return "patch"
    if re.match(r"feat(?:\([^)]+\))?!?: ", title):
        return "minor"
    if re.match(r"fix(?:\([^)]+\))?!?: ", title):
        return "patch"
    return ""


def next_version(base, intent):
    major, minor, patch, _, _ = version_key(base)
    if intent == "minor":
        target = f"v{major}.{minor + 1}.0"
    elif intent == "patch":
        target = f"v{major}.{minor}.{patch + 1}"
    else:
        target = intent
    if version_key(target) <= version_key(base):
        raise ValueError(f"Release version {target} must be newer than {base}")
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    intent = commands.add_parser("intent")
    intent.add_argument("branch")
    intent.add_argument("title")
    bump = commands.add_parser("next")
    bump.add_argument("base")
    bump.add_argument("intent")
    check = commands.add_parser("check")
    check.add_argument("version")
    args = parser.parse_args()
    try:
        if args.command == "intent":
            print(release_intent(args.branch, args.title))
        elif args.command == "next":
            print(next_version(args.base, args.intent))
        else:
            version_key(args.version)
    except ValueError as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
