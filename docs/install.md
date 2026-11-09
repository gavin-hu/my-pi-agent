# Install

`@gavin-hu/my-pi-agent` installs like any other Pi package. Pi reads the package's
manifest and loads each extension, skill, and theme from it; the pack writes no
installed file, so an upgrade is a package upgrade and nothing else.

## Requirements

| Requirement | Why |
|---|---|
| [Pi](https://pi.dev) | The host the pack extends. |
| `git` on `PATH` | `worktree` creates real worktrees and `rewind` keeps real snapshots. Without it both refuse cleanly; every other extension still loads. |
| Windows, macOS, or Linux | All three are supported and the whole test suite runs on each in CI. |

Everything else is optional and degrades on its own: `web-access` fetches without
a key, `file-browse` and `board` need only a loopback socket, `wechat` installs
nothing extra (its `/wechat login` scans a QR code, which needs the interactive
terminal UI), and `notify` falls back to no notification when the OS has no
channel. `/bytefly doctor` lists what each enabled extension needs and what is
missing.

## Install

```bash
pi install npm:@gavin-hu/my-pi-agent
```

That installs the newest release for the current user. To try the package from a
checkout instead:

```bash
pi install ./
```

To pin a release, install from the tag:

```bash
pi install git:github.com/gavin-hu/my-pi-agent@v0.25.1
```

## Check it works

Start Pi and run:

```text
/bytefly
```

The control center opens on its Extensions section: every loaded extension by
name, with a checkbox and, at most, one verdict word. `Space` toggles one,
`/` filters the rows, `!` keeps only what needs attention, and `?` lists every
key.

`/bytefly doctor` prints the same report `run_doctor` gives the model: for each
enabled extension, what it needs at runtime and what is missing, with the install
command or fix beside a missing piece.

## Upgrade

Pi's package manager does it:

```bash
pi update --extensions
```

Once per interactive session the pack also asks Pi's package manager which
configured packages are behind and posts one themed notice naming that command.
`PI_OFFLINE` skips the check; nothing about the session is sent.

## Remove, or switch parts off

Removal is Pi's own:

```bash
pi remove npm:@gavin-hu/my-pi-agent
```

To keep the package and switch a part off, use `/bytefly` — an extension's
checkbox applies to the global scope, or to the project scope with `s` — or set
`PI_DISABLED_EXTENSIONS` for one run. Every extension, skill, and theme can be
turned off without touching the others, and
[A minimal install](./minimal-install.md) is the page that says which to keep.

## Next steps

- [Configuration](./configuration.md) — where a setting lives, and how to change one.
- [Configuration keys](./configuration-reference.md) — every `bytefly.json` key, with
  its default and bounds.
- [All extensions](./extensions/README.md) — what each one does, and the tools and
  commands that deliver it.
- [Security](./security.md) — the loopback surfaces, tokens, and the trust
  boundaries behind them.
