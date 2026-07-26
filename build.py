#!/usr/bin/env python3
"""Bundles the ES modules in src/ into a bookmarklet and an install page.

The modules exist so the code can be tested under node and reused by the Chrome
extension; browsers loading a `javascript:` URL cannot resolve imports, so this
inlines them in dependency order and drops the module syntax.
"""

from __future__ import annotations

import hashlib
import html
import re
import shutil
from pathlib import Path
from urllib.parse import quote

import icons

ROOT = Path(__file__).parent
SRC = ROOT / "src"
DIST = ROOT / "dist"
EXTENSION = ROOT / "extension"
WEB = ROOT / "web"
ENTRY = "main.js"

IMPORT_RE = re.compile(
    r"^import\s+\{(?P<bindings>[^}]*)\}\s+from\s+'(?P<path>[^']+)';\s*$",
    re.MULTILINE,
)
ANY_IMPORT_RE = re.compile(r"^import\s.*$", re.MULTILINE)
EXPORT_RE = re.compile(r"^export\s+(?=(?:function|const|let|class|async))", re.MULTILINE)
EXPORTED_NAME_RE = re.compile(
    r"^export\s+(?:async\s+)?(?:function|const|let|class)\s+(?P<name>[A-Za-z_$][\w$]*)",
    re.MULTILINE,
)


def resolve(entry: str, seen: set[str] | None = None) -> list[str]:
    """Returns module filenames in dependency order, depth first."""
    seen = seen if seen is not None else set()
    if entry in seen:
        return []
    seen.add(entry)

    source = (SRC / entry).read_text()
    order: list[str] = []
    for match in IMPORT_RE.finditer(source):
        dependency = Path(match.group("path")).name
        order.extend(resolve(dependency, seen))
    order.append(entry)
    return order


def module_id(name: str) -> str:
    return "__" + re.sub(r"\W", "_", name)


def wrap_module(name: str, source: str) -> str:
    """Closes a module over its own scope and hands its exports to the next one.

    Concatenating the modules instead would collide: several of them declare a
    HEADINGS or a renderNode of their own, which is only safe because module
    scope keeps them apart.
    """
    unsupported = ANY_IMPORT_RE.findall(IMPORT_RE.sub("", source))
    if unsupported:
        raise SystemExit(
            "only `import { a, b } from './x.js';` is supported by this bundler:\n  "
            + "\n  ".join(unsupported)
        )

    wiring = [
        f"const {{{' '.join(match.group('bindings').split())}}} = {module_id(Path(match.group('path')).name)};"
        for match in IMPORT_RE.finditer(source)
    ]
    exported = [match.group("name") for match in EXPORTED_NAME_RE.finditer(source)]
    body = EXPORT_RE.sub("", IMPORT_RE.sub("", source))
    inner = "\n".join([*wiring, body])

    if name == ENTRY:
        return f"(function () {{\n{inner}\n}})();"
    returns = "return { " + ", ".join(exported) + " };"
    return f"const {module_id(name)} = (function () {{\n{inner}\n{returns}\n}})();"


def compact(source: str) -> str:
    """Drops comment-only lines and blank lines.

    Deliberately conservative: it never touches the inside of a line, so string
    literals and regexes containing // or /* survive untouched.
    """
    lines: list[str] = []
    in_block_comment = False
    for line in source.split("\n"):
        stripped = line.strip()
        if in_block_comment:
            in_block_comment = not stripped.endswith("*/")
            continue
        if stripped.startswith("/*") and not stripped.endswith("*/"):
            in_block_comment = True
            continue
        if not stripped or stripped.startswith("//") or stripped.startswith("*"):
            continue
        if stripped.startswith("/*") and stripped.endswith("*/"):
            continue
        lines.append(line)
    return "\n".join(lines)


def bundle() -> str:
    modules = resolve(ENTRY)
    body = "\n".join(wrap_module(name, (SRC / name).read_text()) for name in modules)
    leftovers = re.findall(r"^\s*(?:import|export)\s.*$", body, re.MULTILINE)
    if leftovers:
        raise SystemExit(
            "module syntax survived bundling, which would fail in the browser:\n  "
            + "\n  ".join(leftovers)
        )
    return f"(function () {{\n'use strict';\n{body}\n}})();"


def install_page(self_contained: str, version: str) -> str:
    """Fills in the install page. It works out its own loader URL in the browser,
    so the same file works from Pages, S3, or anywhere else it is served."""
    template = (WEB / "index.html").read_text()
    page = template.replace("{{SELF_CONTAINED}}", html.escape(self_contained, quote=True))
    page = page.replace("{{VERSION}}", version)
    leftover = re.findall(r"\{\{(\w+)\}\}", page)
    if leftover:
        raise SystemExit(f"install page has unfilled placeholders: {', '.join(leftover)}")
    return page


def build_extension(source: str) -> Path:
    """Assembles a loadable extension from the shared bundle and the manifest."""
    target = DIST / "extension"
    target.mkdir(parents=True, exist_ok=True)

    for name in ("manifest.json", "background.js"):
        (target / name).write_text((EXTENSION / name).read_text())
    (target / "content.js").write_text(source)
    icons.write_all(target / "icons")
    return target


# Reported ceiling for a javascript: bookmarklet in Safari. Undocumented by
# Apple and only ever confirmed by third-party testing, but the failure mode is
# a bookmark that silently does nothing, so the build warns well before it.
SAFARI_URL_LIMIT = 65_536


def main() -> None:
    source = compact(bundle())
    bookmarklet = "javascript:" + quote(source, safe="")
    version = hashlib.sha256(source.encode()).hexdigest()[:8]

    # Everything here is generated, and the whole directory is what gets
    # deployed, so a renamed or dropped file must not linger and go out stale.
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()

    (DIST / "bookmarklet.js").write_text(source)
    (DIST / "bookmarklet.txt").write_text(bookmarklet)
    # The name the loader bookmarklet fetches, and the page that installs it.
    (DIST / "transcript.js").write_text(source)
    (DIST / "index.html").write_text(install_page(bookmarklet, version))
    extension = build_extension(source)

    used = len(bookmarklet) / SAFARI_URL_LIMIT
    print(f"modules   : {', '.join(resolve(ENTRY))}")
    print(f"version   : {version}")
    print(f"source    : {len(source) / 1024:.1f} KB")
    print(f"url       : {len(bookmarklet) / 1024:.1f} KB ({used:.0%} of the Safari ceiling)")
    print(f"install   : {DIST / 'index.html'}")
    print(f"extension : {extension}")

    if used > 0.8:
        print(
            f"\nWARNING: the self-contained bookmarklet is at {used:.0%} of the reported\n"
            f"Safari limit ({SAFARI_URL_LIMIT:,} bytes), past which bookmarklets silently\n"
            "do nothing. The hosted loader is unaffected."
        )


if __name__ == "__main__":
    main()
