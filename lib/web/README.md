# lib/web — the shared browser design system

The tokens, base rules, app shell, `bf-*` components, HTML atoms, and client
runtime the two loopback pages draw with: the plan review
([`../../extensions/plan/web-page.ts`](../../extensions/plan/web-page.ts)) and
file browse ([`../../extensions/file-browse/view/styles.ts`](../../extensions/file-browse/view/styles.ts)).
The module-by-module inventory is the `web/` row of [`../README.md`](../README.md);
this file is the conventions those modules exist to make easy.

Both pages serve a same-origin document through the shared HTTP layer
([`../http/index.ts`](../http/index.ts)) under one CSP. The kit is the one policy
for how that document looks and moves — a second palette, focus ring, or dialog
is the bug this directory prevents.

## Compose the layers in order

A page concatenates `WEB_BASE_CSS`, `WEB_THEME_CSS`, `WEB_LAYOUT_CSS`,
`WEB_COMPONENTS_CSS`, then its own page rules. Each block appears **once**: a
repeated block still renders, so only a count catches it, and every page suite
counts its own stylesheet (`pages.test.ts`, `web.test.ts`). A page rule is
namespaced (`review-*`, `browse-*`) and overrides a kit class rather than
re-declaring it.

## One browser runtime, spliced in

Three surfaces render pages from a bundle held as a template literal, and each had written
the same three helpers for itself: an element builder, a "did this key land in a field?"
test, and a status line's paint. No type checker and no AST scan compares text inside a
string, so the plan's `el(tag, className)` and the board's `el(tag, className, text)` were
two builders, and the plan compared `INPUT` where the board lowercased the tag.

`client-runtime.ts` holds one body of each, as ordinary TypeScript, and exports
`CLIENT_RUNTIME_JS` — the four functions as source, in the order a client reads them. A
page carries it the way it carries `plural` and its class table: the source crosses the
boundary, and the page runs the function instead of a copy of it.

The bodies are JavaScript on purpose — no annotation survives into the string, and no
backtick or `${` may appear in one. The DOM is reached through `globalThis`, because this
project compiles without a DOM lib; the cast names the guarantee the page makes.

What stays page-side: what a status *says*. `paintStatus` owns the text, its tooltip, and
the `bf-status--<tone>` class; the board composes `live · 3m` and appends its own class.
A shared runtime that also decided the wording would be a second copy of the page's voice.

## Name a class once, in a table

A page's document is TypeScript and its client is a string inside a template literal, so
the two halves cannot import from each other: a class name used to be a literal in each,
and one assembled at runtime (`"board-card__reason" + kind`) could not be found by
reading either half. That is how a class reaches a stylesheet with no rule behind it —
an unstyled element, and nothing fails.

So a page declares its vocabulary once, in a `ClassNames` table beside its own modules,
and both halves read it: the document interpolates `${N.toolbar}`, the bundle carries
`namesScript(table)`. A name is then a symbol, and a test can compare the set a page
wears with the set its stylesheet draws, in both directions.

`namesScript` is the boundary, and it throws rather than trusting a caller: a value must
be `KEBAB` — lowercase, hyphenated — because the table is spliced into a template
literal, and a backtick would end the string while `${` would interpolate at build time.
The global it binds must be a JavaScript `IDENTIFIER`. The table's *keys* are the page's
own English; its *values* are what CSS matches, and nothing else in the page may spell
one.

## Color is a role

`WEB_THEME_TOKENS` is derived from `themes/bytefly-dark.json` and
`themes/bytefly-light.json`, so the browser and the TUI cannot drift. Four values
are computed rather than mapped:

- `--accent-soft` — the accent at 15% (dark) or 10% (light), for a selection or
  the active nav row.
- `--on-accent` — the appearance's canvas. A label on the accent fill is dark
  text on the light-blue dark accent and white on the darker light one.
- `--scrim` and `--shadow` — per appearance, because a dimming layer and a lifted
  panel need their own alpha rather than a palette entry.

`--raised` is the one derived neutral: `--surface` mixed 6% (dark) or 3% (light)
toward `--text`, for a block that has to read as a plane above the page rather than
as an outline — the light step is smaller because a darker accent on a lighter step
falls below AA. Components read tokens only: no literal hex or `rgba()` in `components.ts`, and a
test fails one. Contrast is asserted, not assumed — text, muted, and accent at
4.5:1 on both surfaces, the primary label at 4.5:1 on the accent fill, `--dim` at
3:1 because it carries the line-number gutter, and the status colours at 3:1.

The theme layer emits the dark palette at `:root`, the explicit light override,
the system-light fallback, the `tok-*` syntax rules, and **last** a print block
that resets to the light palette: paper is white whatever the screen shows.

## The shell

`.bf-app` is a definite-height column — `100vh`, then `100dvh` — so the header,
sidebar, and main pane scroll inside it instead of the document. `.bf-app__body`
is a 260px sidebar plus main; at `SIDEBAR_COLLAPSE_MAX` (860) the sidebar becomes
a `<details>` disclosure and the page returns to normal scrolling. That is the
only breakpoint the shell owns; a page's own (`820`, `1180`) stays in its
stylesheet, since a media query cannot read a custom property.

A `<details>` lays its content out in a wrapper with no definite height, so a
sidebar that must scroll on its own box positions its panel absolutely rather
than making the panel a flex child. `file-browse` does this; the rule and its
reason are in `layout.ts`.

## The `bf-*` kit

`bf-` marks the kit: brand and mark, toolbar, title, buttons (`--primary`,
`--ghost`, `--icon`), chips and their tones, segmented control, field and input,
textarea, panel, progress, status, note, empty state, dialog (head, body, actions,
status, input, list, option), shortcut sheet and `bf-kbd`, tree, crumbs, table and
sort, card, code, media, Markdown body, comment, composer, and quote chip.

States are attributes, not classes, wherever a control has them:
`aria-pressed`, `aria-current`, `aria-sort`, `aria-expanded`, `hidden`. The base
layer's `[hidden]{display:none!important}` is what lets a `display:flex`
component disappear — do not add a page rule to hide it again.

## Element and script contracts

These names are one agreement between a page, its client, and tests:

| Contract | Owner |
|---|---|
| `#theme-toggle` with a `.theme-glyph` | `themeToggle()` (`markup.ts`) |
| `THEME_JS_PATH` served by both routers | `runtime.ts` |
| `pi-web-theme` in `localStorage` | `WEB_THEME_STORAGE_KEY` |
| `#keys-dialog` (hidden, `aria-modal`) and `#keys-close` | `keysSheet` (`markup.ts`) |
| the page's own sheet trigger id | `keysDialogScript(triggerId)` |
| `window.bfKeys` — `open` / `toggle` / `close` / `isOpen` | `dialogScript` |

`dialogScript(options)` is the one modal implementation: it opens and closes,
closes on a backdrop click, traps `Tab` inside the panel, closes on `Esc` in the
capture phase (so a page's keymap cannot peel a different layer first), restores
focus to whatever opened it, and exposes `window[globalName]`. It renders nothing
when the element is absent, so a page can embed it unconditionally. A page adds
only its own confirm button's listener.

`THEME_JS` is the pre-paint bootstrap and lives in the head; `THEME_TOGGLE_JS`
paints the glyph, follows the system until the reader chooses, and then keeps the
choice. Neither page reloads for a theme.

## Markup atoms and escaping

`docHead`, `brandLockup`, `markIcon`, `tabTitle`, `themeToggle`, `chip`, `button`, and
`keysSheet` return strings. `docHead` links the mark as the tab icon — two SVG
data URIs from the same blocks the lockup draws, the dark one plain and the light
one behind `prefers-color-scheme` — because an icon is its own document and
cannot read the page's tokens.

`tabTitle` is where the three served pages' tab titles agree: `<page> · <subject> ·
<count>`, the page's name lowercase and the same word its `brandLockup` carries, a part
the page does not have left out rather than drawn empty. The board's count is live, so
its page repaints the title on every frame and the body crosses into the bundle as
`TAB_TITLE_JS`, the way `plural` does — one shape for the string, not two. Every dynamic **value** goes through `escapeHtml` from
[`../escape.ts`](../escape.ts); the fields documented as trusted (`css`, an
`icon` glyph, an attribute key, a client id) are code-authored constants, never
model or file text. A page that renders its own document follows the same rule.

The kit is HTML and CSS only; plan text stays out of the page markup and arrives
through the review's JSON island, so the client writes `textContent` and never
markup.

## Print and forced colours

`base.ts` owns both medias. Print un-constrains the shell and drops the toolbar,
sidebar, footer, progress bar, skip link, and dialogs; a page adds what its own
box clips (a card, a code pane, a sticky hunk header). Under
`forced-colors:active` the hand-drawn task checkbox names system colours and the
focus ring stays `CanvasText`, because Windows High Contrast replaces colour but
not a drawn control.

## Keyboard

Every interactive element gets the one focus ring from `base.ts`; a component
must not declare its own, or the ring disappears surface by surface. A dialog
traps `Tab`. Within a page, `j`/`k`, arrows, and `?` follow the TUI's vocabulary
where they mean the same thing; the browse tree is one tab stop with arrows, and
`Enter` follows the focused link.

## Tests

[`web.test.ts`](./web.test.ts) pins the token anchors, the contrast ratios, each
emitted block, the atoms' escaping, and every contract above. A page's suite adds
its own: the stylesheet is shipped once, and the ids its client greps for exist in
the markup.
