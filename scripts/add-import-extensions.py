"""
One-off codemod: add explicit file extensions to relative imports in src/.

Node's ESM resolver does not do extensionless resolution, so `from "../lib/x"`
fails when the server runs TypeScript directly. Vite and `tsc`
(allowImportingTsExtensions) both accept explicit extensions, so writing them
lets the same modules be used by the browser bundle AND by the Node server
with no build step and no duplicated logic.

Kept in the repo rather than run-and-deleted so the change is reproducible if
new files are added with extensionless imports.

USAGE
    python scripts/add-import-extensions.py            # dry run: report only
    python scripts/add-import-extensions.py --write    # actually rewrite files

It reports by default and writes nothing. Rewriting every matching file under
src/ in place, with no backup and no confirmation, is not a thing that should
happen because someone ran a script to see what it did.

Files are written with newline="\n" explicitly. Python's default text mode
translates "\n" to the platform newline on write, so on Windows the previous
version converted every file it touched to CRLF as a side effect of adding an
import extension. .gitattributes now pins the repository to LF; this keeps the
script from fighting it.
"""

import argparse
import os
import re

ROOT = "src"
SOURCE_EXTS = (".ts", ".tsx", ".js", ".jsx")

pattern = re.compile(r"""(from\s+|import\s+)(['"])(\.\.?/[^'"]+)(['"])""")
already = re.compile(r"\.(ts|tsx|js|jsx|json|css)$")


def build_index():
    """module path (no extension) -> the extension the file actually has"""
    known = {}
    for dirpath, _dirs, files in os.walk(ROOT):
        for name in files:
            base, ext = os.path.splitext(name)
            if ext in SOURCE_EXTS:
                key = os.path.normpath(os.path.join(dirpath, base)).replace(os.sep, "/")
                known[key] = ext
    return known


def rewrite(original, dirpath, known):
    def fix(match, _dir=dirpath):
        prefix, quote, spec, close = match.groups()
        if already.search(spec):
            return match.group(0)
        target = os.path.normpath(os.path.join(_dir, spec)).replace(os.sep, "/")
        if target in known:
            return prefix + quote + spec + known[target] + close
        index = target + "/index"
        if index in known:
            return prefix + quote + spec + "/index" + known[index] + close
        return match.group(0)

    return pattern.sub(fix, original)


def main():
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument(
        "--write",
        action="store_true",
        help="rewrite files in place. Without it, nothing is written.",
    )
    args = parser.parse_args()

    known = build_index()
    changed = []

    for dirpath, _dirs, files in os.walk(ROOT):
        for name in files:
            if not name.endswith(SOURCE_EXTS):
                continue
            path = os.path.join(dirpath, name)
            with open(path, encoding="utf-8") as handle:
                original = handle.read()

            updated = rewrite(original, dirpath, known)
            if updated == original:
                continue

            changed.append(path)
            if args.write:
                # newline="\n": never emit CRLF, whatever platform this runs on.
                with open(path, "w", encoding="utf-8", newline="\n") as handle:
                    handle.write(updated)

    verb = "rewrote" if args.write else "would rewrite"
    print("%s %d files" % (verb, len(changed)))
    for item in changed:
        print("   ", item)
    if changed and not args.write:
        print("\nDry run — nothing was written. Re-run with --write to apply.")


if __name__ == "__main__":
    main()
