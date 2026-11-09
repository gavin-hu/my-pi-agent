# my-pi-agent — a Pi package for working in a terminal

`@gavin-hu/my-pi-agent` is a set of extensions, skills, and themes for
[Pi](https://pi.dev): the coding agent you run from a terminal. It does not fork
Pi and writes no installed file — Pi discovers everything through the package's
own manifest, so the pack upgrades like any other package.

Everything in it is optional and independently switchable.

<img src="./assets/screens/chrome.webp" width="1280" height="964" alt="The my-pi-agent header, footer, and transcript blocks" fetchpriority="high">

## Install

Requires a working Pi installation. `git` on `PATH` is needed by `worktree` and
`rewind`; everything else degrades or disables cleanly.

```bash
pi install npm:@gavin-hu/my-pi-agent
```

To pin a release, install from the tag instead:

```bash
pi install git:github.com/gavin-hu/my-pi-agent@v0.25.1
```

Then `/bytefly` opens the control center, where each extension can be switched on
or off, its settings changed, and `/bytefly doctor` names anything missing.
[Install](./install.md) has the upgrade, removal, and requirements in full.

## What you get

21 extensions, 3 packaged skills, and 2 themes, grouped by the promises this
page makes. The [extension index](./extensions/README.md) lists every one, and
the [README](https://github.com/gavin-hu/my-pi-agent#what-you-get) carries the
same catalog with the tools and commands each delivers.

- **Plan before writing.** `plan` keeps a task in read-only planning mode, saves a
  plan under `~/.pi/agent/plans/<repo-key>`, and waits for your approval.
- **Never wreck the checkout.** `worktree` moves a task onto its own branch in a
  `git worktree`, and `rewind` snapshots each prompt's first change.
- **Delegate in parallel.** `subagent` runs a specialist agent in its own Pi
  process; `session-bus`, `board`, and `team` coordinate several sessions on one
  repository.
- **Long work in the background.** `job` runs a shell command and keeps its log,
  `watch` tails a file or command, and `todo` and `goal` keep the thread visible.
- **Reach the web and your files.** `web-access` searches and fetches, `file-browse`
  serves the working directory to a loopback page, `file-read` extracts PDF, DOCX,
  XLSX, and more, and `file-open` hands a file to the OS.
- **A terminal that explains itself.** `bytefly` gives Pi its header, footer,
  transcript blocks, settings screen, and notifications.

### Skills

Packaged workflows loaded on demand: each skill's name and description are
advertised to the model, and its instructions load only when the task matches
(`/skill:<name>` forces one).

| Skill | What it does |
|---|---|
| `init` | Creates or updates the instruction file Pi reads, through an interactive interview and a plan you review. |
| `refactor` | Audits for duplication, oversized modules, coupling, and drift, then carries the refactor you pick. |
| `next` | Suggests what to do next from this conversation, or from the tree when it is empty. |

### Themes

`bytefly-dark` is a GitHub-inspired dark palette and `bytefly-light` its light
companion, with optional automatic light/dark switching. Installing the pack does
not change your theme: pick one through `/bytefly settings` → **Theme**, or set
`"theme": "bytefly-light/bytefly-dark"` for switching.

## What runs on its own

Once per interactive session, `bytefly` asks Pi's package manager which
configured packages are behind, and posts one themed notice naming
`pi update --extensions`; a newer Pi gets a notice naming `pi update`. Nothing
about the session is sent, and `PI_OFFLINE` skips the check —
[Security](./security.md) covers the trust boundaries.

## Start here

- [Install](./install.md) — add the pack to Pi, pin a version, upgrade it.
- [Configuration](./configuration.md) — where a setting lives, how to change one,
  and every key with its default.
- [All extensions](./extensions/README.md) — one page per extension, opening with
  what it does and the tools and commands that deliver it.
- [Skills](./skills/README.md) — the three packaged workflows, and when to reach
  for one instead of asking in words.
- [Security](./security.md) — what the pack opens on your machine, and how each
  surface is gated.

## Where to get help

`/bytefly doctor` prints what each enabled extension needs at runtime and what is
missing. The [repository](https://github.com/gavin-hu/my-pi-agent) carries the
[changelog](https://github.com/gavin-hu/my-pi-agent/blob/main/CHANGELOG.md), the
[issue tracker](https://github.com/gavin-hu/my-pi-agent/issues), and the
[contributor guide](https://github.com/gavin-hu/my-pi-agent/blob/main/CONTRIBUTING.md).
