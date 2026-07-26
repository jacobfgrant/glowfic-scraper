#!/usr/bin/env python3
"""Bundles the ES modules in src/ into a bookmarklet and an install page.

The modules exist so the code can be tested under node and reused by the Chrome
extension; browsers loading a `javascript:` URL cannot resolve imports, so this
inlines them in dependency order and drops the module syntax.
"""

from __future__ import annotations

import html
import re
from pathlib import Path
from urllib.parse import quote

import icons

ROOT = Path(__file__).parent
SRC = ROOT / "src"
DIST = ROOT / "dist"
EXTENSION = ROOT / "extension"
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


def install_page(bookmarklet: str, size_kb: float) -> str:
    return f"""<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Install: Glowfic → clean transcript</title>
<style>
  body {{ font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif;
         max-width: 40rem; margin: 3rem auto; padding: 0 1.25rem; color: #24211d; }}
  h1 {{ font-size: 1.5rem; }}
  .drag {{ display: inline-block; margin: 1.5rem 0; padding: .7rem 1.2rem; background: #6d4c7d;
           color: #fff; border-radius: 6px; text-decoration: none; font-weight: 600; }}
  ol {{ padding-left: 1.2rem; }}
  li {{ margin: .5rem 0; }}
  code {{ background: #f1eee9; padding: .1rem .3rem; border-radius: 3px; font-size: .9em; }}
  .note {{ color: #6a6259; font-size: .9rem; border-top: 1px solid #e6e1d8;
           margin-top: 2.5rem; padding-top: 1rem; }}
</style>

<h1>Glowfic → clean transcript</h1>
<p>Turns a glowfic thread into a stripped-down markdown transcript you can paste
into a chat window or attach as a file.</p>

<ol>
  <li>Make sure your bookmarks bar is visible — <code>⌘⇧B</code> in Chrome.</li>
  <li>Drag this button up onto it:</li>
</ol>

<p><a class="drag" href="{html.escape(bookmarklet, quote=True)}">Glowfic → transcript</a></p>

<ol start="3">
  <li>Open any thread on <code>glowfic.com</code> and click the bookmark.</li>
  <li>Pick whole thread, this page, or a page range, then Copy or Download.</li>
</ol>

<p class="note">Clicking the button on this page does nothing — it only works on a
glowfic thread. It reads threads using your existing glowfic login, so
access-locked threads work exactly as they do when you are reading them.
Bookmarklet size: {size_kb:.1f} KB.</p>
</html>
"""


def build_extension(source: str) -> Path:
    """Assembles a loadable extension from the shared bundle and the manifest."""
    target = DIST / "extension"
    target.mkdir(parents=True, exist_ok=True)

    for name in ("manifest.json", "background.js"):
        (target / name).write_text((EXTENSION / name).read_text())
    (target / "content.js").write_text(source)
    icons.write_all(target / "icons")
    return target


def main() -> None:
    source = compact(bundle())
    bookmarklet = "javascript:" + quote(source, safe="")

    DIST.mkdir(exist_ok=True)
    (DIST / "bookmarklet.js").write_text(source)
    (DIST / "bookmarklet.txt").write_text(bookmarklet)
    (DIST / "install.html").write_text(install_page(bookmarklet, len(bookmarklet) / 1024))
    extension = build_extension(source)

    print(f"modules   : {', '.join(resolve(ENTRY))}")
    print(f"source    : {len(source) / 1024:.1f} KB")
    print(f"url       : {len(bookmarklet) / 1024:.1f} KB")
    print(f"install   : {DIST / 'install.html'}")
    print(f"extension : {extension}")


if __name__ == "__main__":
    main()
