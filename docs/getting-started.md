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
# Personal install, tracking the default branch
pi install git:github.com/gavin-hu/my-pi-agent

# Pin a release (recommended for a stable setup)
pi install git:github.com/gavin-hu/my-pi-agent@v0.6.1

# Project-local install (.pi/settings.json in the current project)
pi install ./ -l

# Try the checkout for a single run, without installing
pi -e .
```

Distribution is git-only; nothing is published to npm. A release is an annotated
`vX.Y.Z` tag, so pinning a tag is the supported way to hold a version.

## Verify the load

From inside Pi:

- `/extensions` lists every resolved extension across all configured packages
  and lets you enable or disable one (written to Global or Project settings,
  applied on reload).
- `/doctor [extension]` reports whether each enabled extension has what it needs
  at runtime — binaries on `PATH`, optional packages, login/state files, and
  config files that fail to parse. It warns at session start when an enabled
  extension cannot work.
- `/doctor` is read-only; the `run_doctor` tool exposes the same report to the
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
