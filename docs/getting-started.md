# Getting started

## Requirements

- A working [Pi](https://pi.dev) installation. `my-pi-agent` is a Pi package,
  not a fork or a patch.
- `git` on `PATH` if you want the [`worktree`](../extensions/worktree/) and
  [`rewind`](../extensions/rewind/) extensions; the rest of the pack does not
  need it.
- Windows, macOS, or Linux. The full check suite runs on all three in CI.

Extensions are plain TypeScript loaded by Pi through `jiti`, so there is no
build step to run the package.

## Install

```bash
# Published release from npm
pi install npm:@gavin-hu/my-pi-agent

# Personal install from git, tracking the default branch
pi install git:github.com/gavin-hu/my-pi-agent

# Pin a release (npm versions and git tags name the same version)
pi install git:github.com/gavin-hu/my-pi-agent@v0.13.0

# Project-local install (.pi/settings.json in the current project)
pi install ./ -l

# Try the checkout for a single run, without installing
pi -e .
```

Releases are published to npm and annotated as `vX.Y.Z` tags in git; both name
the same version, so either source pins a stable setup.

## Verify the load

From inside Pi:

- `/bytefly [extension] [refresh]` opens one docked screen listing every
  resolved extension — its enable checkbox and its runtime health on each row,
  the focused extension's findings underneath. `Space` toggles one (written to
  Global or Project settings, applied on reload) and `r` re-probes;
  `/bytefly doctor` prints the doctor report (the same screen in `tui`).
- The screen reports whether each enabled extension has what it needs at runtime
  — binaries on `PATH`, optional packages, login/state files, and config files
  that fail to parse — and warns at session start when an enabled extension
  cannot work.
- The check is read-only; the `run_doctor` tool exposes the same report to the
  model.

## Themes

Select `bytefly-dark` or `bytefly-light` through `/settings` → **Theme**, or use
automatic light/dark switching with:

```json
{ "theme": "bytefly-light/bytefly-dark" }
```

`pi --use-theme bytefly-dark` selects one for a single run. Pi themes cannot set
the terminal's background, so the live canvas stays your terminal's color — set
it to `#0d1117` for the intended look. HTML exports use the theme's
`export.pageBg`, so they are unaffected.

A theme is ordinary Pi theme JSON: to build your own, start from
[`themes/bytefly-dark.json`](../themes/bytefly-dark.json) and follow Pi's
[Themes](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/themes.md)
reference. The shipped palettes are held to WCAG AA per semantic role by
`test/theme.test.ts`.

## Disabling extensions

Every extension in this package is on by default. Set `PI_DISABLED_EXTENSIONS`
to a comma- or whitespace-separated list of extension names (the directory names
under [`extensions/`](../extensions/)) to load the package without them:

```bash
PI_DISABLED_EXTENSIONS=todo,job pi -e .
```

Names are compared case-insensitively and unknown names are ignored. This is a
package-local switch: Pi still imports each entrypoint, but a disabled factory
registers nothing. To drop the whole package instead, use Pi's `--no-extensions`
or remove the package from your settings.

## Where to go next

- [Extensions](./extensions.md) — what each one does and the names it registers.
- [Configuration](./configuration.md) — per-extension settings and environment
  variables.
- [`../extensions/<name>/README.md`](../extensions/) — the full surface of one
  extension.
