# Architecture

This page is a map of how the package is put together. The normative rules live
in [`../AGENTS.md`](../AGENTS.md); this is the orientation that makes them make
sense.

## The manifest is the load list

Pi does not scan for extensions. It reads the `pi` manifest in
[`../package.json`](../package.json), which lists every extension entrypoint,
the theme glob, and the header image. Adding a resource means adding it to the
manifest; [`extensions.md`](./extensions.md) lists what is there today.

Extensions are plain TypeScript. Pi loads each entrypoint through `jiti`, so
there is no build step and no bundling.

## A factory registers; lifecycle hooks run

An extension's exported factory does one thing: register tools, commands,
renderers, and keybindings. It does not start long-lived resources. Anything
that lives beyond the call — servers, watchers, bridges, background processes —
starts from the `session_start` hook and is released in an idempotent
`session_shutdown`. That split is what makes `/resume`, `/tree`, and RPC modes
safe.

## `lib/` is shared between isolated module caches

Pi loads each extension with an **isolated module cache**, so the same `lib/`
module is instantiated once per extension. Consequences:

- `lib/` is value-only: pure functions, constants, and classes. A module-level
  variable would exist once per extension, not once shared, so cross-extension
  state is forbidden. The one exception is the event-bus pattern in `rails.ts`,
  where the state lives in the caller's closure.
- No extension imports another extension's modules. Shared tool and parameter
  names live in [`../lib/tool-names.ts`](../lib/tool-names.ts); shared glyphs and
  status keys in [`../lib/tui/glyphs.ts`](../lib/tui/glyphs.ts); anything else a second
  extension needs moves into `lib/`.

[`../lib/README.md`](../lib/README.md) documents every shared module and the
host-seam pattern (inject a function such as `RunGit` or an HTTP runner rather
than the whole `ExtensionAPI`).

## State that survives `/resume` and `/tree`

The session branch is the source of truth. Any state that must survive a resume
or a branch switch is written to tool-result `details` or a custom session
entry, then rebuilt from `ctx.sessionManager.getBranch()` on start. Widgets are
derived from that state on each render and are never authoritative.

## Prompt budget

Everything an extension puts in front of the model — `description`,
`promptSnippet`, `promptGuidelines`, parameter docs, injected context — is
always-on context. Each channel has one job, and injected context is capped:
[`../test/prompt-budget.test.ts`](../test/prompt-budget.test.ts) holds the
ceilings.

## TUI conventions

The package follows Pi's built-in TUI design system rather than inventing a
visual language. Use the host surfaces first (`ctx.ui.select` / `confirm` /
`input` / `editor`, then `notify` / `setStatus` / `setWidget`), then the pi-tui
components. The shared implementation is the `lib/tui/` design system
([`../lib/tui/tokens.ts`](../lib/tui/tokens.ts) roles,
[`chrome.ts`](../lib/tui/chrome.ts) screen chrome,
[`rules.ts`](../lib/tui/rules.ts), [`rows.ts`](../lib/tui/rows.ts),
[`columns.ts`](../lib/tui/columns.ts), [`gauge.ts`](../lib/tui/gauge.ts),
[`line-pane.ts`](../lib/tui/line-pane.ts),
[`status-controller.ts`](../lib/tui/status-controller.ts),
[`tool.ts`](../lib/tui/tool.ts) (the tool-transcript kit),
[`glyphs.ts`](../lib/tui/glyphs.ts) glyphs and status keys, and
[`cursor.ts`](../lib/tui/cursor.ts) list behaviour and scroll math). Colors come
from a semantic role, never a literal. Width is terminal columns, not string
length, and model- or file-authored text is sanitized at the boundary before it
reaches a widget or the terminal.

## Where to read more

| Topic | Document |
|---|---|
| Repo invariants and the contributor workflow | [`../AGENTS.md`](../AGENTS.md) |
| Shared helpers and host seams | [`../lib/README.md`](../lib/README.md) |
| Test tiers and determinism | [`../test/README.md`](../test/README.md) |
| One extension's full surface and integration contract | [`../extensions/<name>/README.md`](../extensions/) |
