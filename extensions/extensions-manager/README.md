# extensions-manager — list and toggle Pi extensions

`extensions-manager` adds the `/extensions` command: a keyboard-driven dock
screen that lists every resolved Pi extension across all configured packages
(personal and project) and enables or disables one by writing the relevant
`settings.json`. It reuses Pi's own settings and package resolution, so the
list matches what a session actually loads. Changes apply on `/reload`.

```bash
pi --extension ./extensions/extensions-manager   # load just this extension
pi -e .                                          # load the whole @gavin-hu/my-pi-agent package
pi install ./                                    # install the package
```

## What it does

- Lists every extension Pi resolves, grouped by source (each package, user
  settings, project settings) and sorted packages-first.
- Shows whether each one is enabled (`[x]`) or disabled (`[ ]`).
- Toggles the focused extension with `Space`/`Enter`, writing `+pattern` /
  `-pattern` into `extensions` (and package filter objects) in
  `<agent-dir>/settings.json` or `<cwd>/.pi/settings.json`.
- Switches the write scope with `Tab`: **Global** (personal settings) or
  **Project** (`.pi/settings.json`, only when the project is trusted).
- Offers a reload after pending changes so the new selection takes effect
  without leaving the session.

## Commands

| Command | Effect |
|---|---|
| `/extensions` | In a terminal, open the dock list. Elsewhere, print the same list as text. |

### Keys

| Key | Effect |
|---|---|
| `Space` / `Enter` | Toggle the focused extension. |
| `Tab` | Switch between Global and Project scope. |
| `↑`/`↓`, `j`/`k` | Move the selection. |
| `PgUp`/`PgDn` | Move a page. |
| `g` / `G`, `Home` / `End` | Jump to the first or last extension. |
| `Esc` / `Ctrl+C` | Close the screen. |

Mouse wheel scrolling works in fullscreen mode; every action also has a
keyboard path.

## Behaviour by mode

| Mode | Behaviour |
|---|---|
| `tui` | Opens the dock list and toggles in place. |
| `rpc`, `json`, `print` | Custom terminal components are unavailable, so `/extensions` prints the grouped list and does not toggle. |

## Security

- Project settings are only read or written when the project is trusted
  (`ctx.isProjectTrusted()`); an untrusted session offers Global scope only.
- Discovery never installs or fetches a package: missing sources are skipped.
- The extension registers no model-facing tool, so the model cannot change
  resource configuration.

## Limitations

- Only the `extensions` resource type is managed. Skills, prompts, and themes
  are handled by Pi's own `pi config`.
- Built-in extensions (`builtin:mcp`, `builtin:codemode`, …) are not listed:
  their authoritative names are not exposed to extensions. Use `pi config`.
- Packages are not installed, removed, or updated here; use `pi install`,
  `pi remove`, and `pi update`.
- Project toggles are two-state (`enable`/`disable`). Resetting an override back
  to "inherit" is done in `pi config`.

## Pi integration

| Contract | Detail |
|---|---|
| Registration | The default export registers one command; no tools, flags, widgets, or long-lived resources. |
| Command | `pi.registerCommand("extensions")`; handler receives `ExtensionCommandContext`. |
| Discovery | `SettingsManager.create(...)` plus `DefaultPackageManager.resolve({ onMissing: "skip" })`, both public exports of `@earendil-works/pi-coding-agent`. |
| Settings writes | `SettingsManager` setter methods (`setExtensionPaths`, `setPackages`, `setProjectExtensionPaths`, `setProjectPackages`), then `flush()`. |
| State | The screen is derived from live runtime state; nothing is persisted outside `settings.json`. |
| UI | `ctx.ui.custom()` in a dock (not an overlay), rails suppressed through `withRailsSuppressed`; `ctx.ui.notify()` in other modes. |
| Reload | `ctx.reload()` after the screen closes when changes are pending. |
| Lifecycle | No `session_start`/`session_shutdown` handlers; hosts managers are created per command invocation. |

## Design notes

- **Reuse Pi's resolution; port only the toggle.** `DefaultPackageManager` and
  `SettingsManager` are public exports, so the list matches what Pi loads. The
  pattern arithmetic is a trimmed port of Pi's config selector
  (`config-selector.js`), kept pure and separately tested so a future drift is
  easy to diff.
- **Two views, one write scope.** Personal (`global`) and effective (`project`)
  resources are resolved separately, mirroring `pi config`; the screen shows the
  view for the active scope and writes through the matching store.
- **Never install during discovery.** `resolve` gets an `onMissing` handler that
  returns `"skip"`, so opening the screen cannot change installed packages.
- **Project packages are deltas.** A project override of a package resource is
  written with `autoload: false`, so it filters the personal entry instead of
  replacing it, matching Pi's documented project semantics.
- **No half-applied state.** A failed write surfaces an error and leaves the row
  unchanged; a successful write marks the screen dirty and the screen offers a
  reload on close.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: `isExtensionEnabled` guard and command registration. |
| `types.ts` | Host seams (`SettingsStore`, `ExtensionResolver`, `Discovery`) and row types. |
| `resources.ts` | Pure grouping, labels, display names, pattern helpers, text listing. |
| `toggle.ts` | Pure next-settings transforms for global and project toggles. |
| `discovery.ts` | Host wiring: builds the global and effective views from Pi's managers. |
| `runtime.ts` | Scope, live view copies, dirty tracking, and persistence. |
| `tui.ts` | `ExtensionsListComponent`, the dock screen. |
| `commands.ts` | `/extensions`: TUI path and text fallback. |

## Testing

`bun test extensions/extensions-manager` covers the pure helpers, the toggle
transforms, discovery with an injected factory, the runtime state machine, the
screen's rendering and key handling, and the command through `createFakePi` /
`fakeCtx`.
