# Glowfic Transcript

Turns a [glowfic](https://glowfic.com) thread into a clean, portable transcript
— for reading offline, keeping a copy, or pasting into a chat.

It reads threads through the site's own API, on a click, using the login you
already have, and it respects access controls exactly as the site does. It does
not crawl, and it does not republish anything.

The site's own HTML is far heavier than the story inside it: a 369-reply thread
renders as 575 KB of markup, which mostly gets in the way when you want to
discuss the writing. The same thread comes out of this as 92 KB — about 23k
tokens — with nothing lost but styling.

It writes either markdown or clean HTML:

| | 369-reply thread | tokens |
| --- | --- | --- |
| glowfic.com | 575 KB | — |
| markdown | 92 KB | ~23k |
| HTML | 124 KB | ~31k |

Markdown is the cheaper of the two and the default. The HTML is a standalone
file — inline stylesheet, no assets, light and dark — so it opens straight in a
browser if you want to read or skim the export before handing it over.

```
# New neighbors. Just as frustrating.
Sandboxes · lintamande & Rockeye · 369 replies
https://glowfic.com/posts/100
_Mountain and Elves_

## Mountain (Rockeye) [confusion]
When your neighbors kill you when you were just trying to have a polite
discussion about mutual problems, it's probably not a good sign.

*I respawned. But... Where the hell am I?*

## lintamande [Celegorm]
She's on an ocean. There are boats. They're on fire.
```

Every entry keeps its character, its author, and its icon keyword, because the
icon is how a glowfic carries expression. Emphasis survives; wrapper markup,
styling, avatars, and timestamps do not.

## Install

**Bookmarklet.** Visit the install page and drag the button onto your bookmarks
bar — that works in Safari as well as Chrome, Firefox and Edge. Safari refuses
`javascript:` in the address bar, so if dragging fails there is a
bookmark-then-edit-the-address route behind a *If dragging doesn't work*
disclosure. Locally: `python3 build.py`, then open `dist/index.html`.

The bookmark loads its code from wherever the page is served, so fixes reach
everyone without reinstalling. A self-contained version that depends on nothing
is on the same page, under *Self-contained version*.

**Chrome extension.** Run `python3 build.py`, then in `chrome://extensions`
enable Developer mode and *Load unpacked* → `dist/extension`. A toolbar button
appears; click it on any thread.

Safari can load that same directory through *Develop → Add Temporary
Extension…*, with no signing and no Xcode — useful for checking rendering,
though it expires after 24 hours or when Safari quits.

## Using it

Clicking opens a panel that asks what to export before it fetches anything:

- **Whole thread** — every reply, via the API.
- **This page** — exactly what is on screen, read from the page itself, so it
  respects your posts-per-page setting and costs no extra requests.
- **A page range** — numbered the way the site numbers pages for you.

Then pick a format and either **Copy** it or **Download** it. Long threads are
split into numbered files, each one complete on its own — headers repeated, and
in HTML a full document with its own stylesheet. The split size is adjustable
and defaults to 300k characters, roughly 75k tokens. Above 250k characters the
panel steers you toward downloading, since pasting stops being practical. Chrome
asks once per site before saving multiple files.

Changing the format, the split size, or the icon and link switches re-renders
what was already fetched instead of hitting the site again.

## Access and etiquette

Both forms read threads through your own logged-in session, so locked threads
work exactly as they do when you are reading them, and no credentials are
stored anywhere. The extension asks for `activeTab` and `scripting` and nothing
else: it gets access to one tab at the moment you click its button, holds no
standing permission on any site, and sends nothing anywhere.

Fetches are sequential with a short gap between them, which matters on threads
like *planecrash* where a full read is 45 requests. `robots.txt` does not
restrict `/api/v1/`, and this only ever runs when a person clicks it — but it is
someone else's writing on someone else's server, so keep it to reading and don't
republish what you pull down.

## Development

```
npm install     # jsdom, for tests only
npm test        # builds first, then node --test
python3 build.py
```

`npm test` builds before running, because several tests read `dist/` and the
build clears it — test files run in parallel, so they must not build
themselves.

`src/` holds ES modules so they can be tested under node and shared between both
targets:

- `glowfic.js` — URL parsing, the API client, normalizing entries
- `markdown.js`, `cleanhtml.js` — the two converters, each a DOM walk
- `formats.js` — assembling entries into a finished document, and splitting it
- `panel.js` — the in-page UI

`build.py` gives each module its own scope and wires the exports together, since
several of them declare a `HEADINGS` or a `renderNode` of their own and plain
concatenation would collide. The result becomes a `javascript:` URL — a
bookmarklet cannot resolve imports — and `dist/extension`. Icons are drawn by
`icons.py` rather than committed as binaries.

Tests cover both converters, document assembly and splitting, and the panel
wiring under jsdom, using a fixture cut from a real thread page. `bundle.test.js`
builds the real bundle and runs it in a page, which is what catches scope
collisions; a syntax check alone does not. None of it substitutes for clicking
the real thing in a real browser.

## Publishing

The install page and the loader script deploy to GitHub Pages on every push to
the default branch, via `.github/workflows/pages.yml`, which runs the tests
first. Nothing generated is committed — the workflow builds `dist/` and uploads
it, so the deployed page is always the current source.

**Chrome Web Store** is a $5 one-time registration plus a listing. The
permission profile is deliberately minimal — `activeTab` and `scripting`, no
host permissions — which should keep review quick.

Note that "collects nothing" is not the right answer on the privacy form.
Chrome counts *"clipping or scraping content from a website that the user
visits"* as handling user data **even when it never leaves the device**, so
**Website content** has to be declared, and declaring anything makes a privacy
policy URL mandatory. That policy is `web/privacy.html`, published alongside the
install page. Answer "no" to remotely hosted code: the extension bundles
everything, and only the bookmarklet loads remotely.

The listing should say plainly that this is unofficial and not affiliated with
glowfic.com, and that it exports threads the reader is already permitted to
read, for personal use, without republishing.

**Firefox** is free to publish on AMO, but not quite a drop-in port: Firefox
implements MV3 background scripts as non-persistent event pages, so the manifest
needs a `background.scripts` key alongside `service_worker`.

**Safari is not worth it.** A Safari web extension has to ship inside a signed
native app, which requires the Apple Developer Program at $99/year. There is no
free path for personal use either: "Allow Unsigned Extensions" resets every time
Safari quits, personal-team signing does not avoid it, and *Add Temporary
Extension…* expires within a day. Safari users get the bookmarklet.

## Size ceiling

Safari is reported — by third-party testing, not by Apple — to cap
`javascript:` bookmarklets around 64 KB, past which they silently do nothing.
`build.py` prints how much of that the self-contained build uses and warns above
80%. It is already past that mark, which is why the loader is the default: it
stays a couple of hundred bytes no matter how large the program gets.
