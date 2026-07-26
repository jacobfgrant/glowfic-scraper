# Glowfic → clean transcript

Turns a [glowfic](https://glowfic.com) thread into a stripped-down markdown
transcript, for pasting into a chat window or attaching as a file.

The site's own HTML is far heavier than the story inside it: a 369-reply thread
renders as 575 KB of markup, which mostly gets in the way when you want to
discuss the writing. The same thread comes out of this as 92 KB — about 23k
tokens — with nothing lost but styling.

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

Either form does the same thing and shares the same code.

**Bookmarklet.** Run `python3 build.py`, open `dist/install.html`, and drag the
button onto your bookmarks bar. Open any thread and click it.

**Chrome extension.** Run `python3 build.py`, then in `chrome://extensions`
enable Developer mode and *Load unpacked* → `dist/extension`. A toolbar button
appears; click it on any thread.

## Using it

Clicking opens a panel that asks what to export before it fetches anything:

- **Whole thread** — every reply, via the API.
- **This page** — exactly what is on screen, read from the page itself, so it
  respects your posts-per-page setting and costs no extra requests.
- **A page range** — numbered the way the site numbers pages for you.

Then either **Copy** it or **Download** it. Long threads are split into numbered
files, each repeating the header so it stands on its own; the split size is
adjustable and defaults to 300k characters, roughly 75k tokens. Above 250k
characters the panel steers you toward downloading, since pasting stops being
practical. Chrome asks once per site before saving multiple files.

Icon keywords and links can each be switched off if you want the text barer.

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
npm test        # node --test
python3 build.py
```

`src/` holds ES modules so they can be tested under node and shared between both
targets; `build.py` inlines them into a `javascript:` URL, since a bookmarklet
cannot resolve imports, and assembles `dist/extension`. Icons are drawn by
`icons.py` rather than committed as binaries.

Tests cover the HTML→markdown conversion, transcript formatting and splitting,
and the panel wiring under jsdom, using a fixture cut from a real thread page.
The panel tests are not a substitute for clicking the real thing in Chrome.

## Publishing the extension

Not done yet. It needs a $5 one-time developer registration, a store listing
with screenshots, and a privacy disclosure — which is short, since the extension
collects nothing. The permission profile is deliberately minimal to keep review
quick.
