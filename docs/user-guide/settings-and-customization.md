# 6. Settings and customization

The pack's visible layer — the control centre, the settings screen, the footer,
the theme, notifications, and the health report — is one extension called
`bytefly`. This chapter shows how to change its behaviour, how to switch any
extension off, and how to remove the pack without losing your work.

**Use this chapter when** you want the pack to look or behave differently, an
extension is not doing what you expect, or you need to take the pack off a
machine.

## The control centre

Open it with:

```text
/bytefly
```

You land on **Extensions**: one row per installed extension, an enable checkbox,
and a health verdict. Under the focused row is that extension's report. Press
`→` for **Settings**, or open it directly with `/bytefly settings`.

| Key | What it does |
|---|---|
| `←` / `→` | Switch between Extensions and Settings |
| `↑` / `↓`, `j` / `k` | Move the selection |
| `PgUp` / `PgDn` | Move a page |
| `Home` / `End`, `g` / `G` | Jump to the first or last row |
| `Space` | Turn the focused extension on or off (Extensions); change a setting (Settings) |
| `Enter` | Expand the focused extension's findings, or change a setting |
| `Tab` | Switch between Global and Project scope |
| `x` | Clear a project-level override for the focused extension |
| `u` | Reset the focused setting to its default |
| `J` | Show or hide the focused row's whole config section |
| `[` / `]` | Jump to the previous or next settings group |
| `r` | Re-run the health checks |
| `Esc` or `Ctrl+C` | Close |

Mouse scrolling works, and clicking a row focuses it. Every action also has a
keyboard path.

<img src="../../assets/bytefly.png" alt="The /bytefly control centre: the Extensions and Settings sections, one row per extension with its checkbox and health verdict, and the focused extension's report" width="100%">

*The control centre: switch an extension off with `Space`, and read its health
underneath.*

### Commands

| Command | What it does |
|---|---|
| `/bytefly` | Open the control centre on Extensions |
| `/bytefly <extension>` | Open it filtered to one extension |
| `/bytefly settings` | Open it on Settings |
| `/bytefly doctor [extension] [refresh]` | Print the health report |
| `/bytefly update` | Re-run the package update check |
| `/bytefly [extension] refresh` | Open the Extensions section and re-probe health instead of using the session cache |

`/bytefly settings` rejects an extension name; the Extensions section accepts
one. `doctor` accepts an extension name too. In text-only modes, the command
prints the grouped listing or report instead of mounting the screen.

## Settings

`/bytefly settings` groups the curated settings into ten sections. Choose a row
and press `Space` or `Enter`: a switch toggles, a choice cycles to the next
option, and a text field opens an editor whose value you save with `Enter` or
discard with `Esc`.

| Group | What it controls |
|---|---|
| **Startup** | Whether the bytefly startup header replaces Pi's compact startup detail |
| **Notifications** | Desktop notifications, the four triggers, the delivery method, and the title |
| **Diagnostics** | The proactive health check and its per-probe timeout |
| **Pricing** | Currency, cost decimals, and the optional session budget |
| **Transcript** | The rail glyph, how an achieved goal renders, and output padding |
| **Terminal** | The theme and the hardware cursor |
| **Worktree** | Base ref, branch prefix, fetch-before-branch, and prune age |
| **Snapshots** | Automatic snapshots, how many to keep, and the pre-restore safety snapshot |
| **Jobs and watchers** | Wake when a job finishes, keep jobs after exit, wake on a watcher match |
| **Memory** | Whether stored notes are injected before a run |

The screen shows the effective value and where it comes from: project, global,
or default. A project value overrides a global one. App-level preferences such as
the theme, startup header, and cursor are global only; the screen says so when
you try to set them at project scope. Two scopes write different files:

| Scope | File | Applies to |
|---|---|---|
| Global | `<agent-dir>/bytefly.json`, or Pi's personal settings for app preferences | Every project |
| Project | `<repo>/.pi/bytefly.json` | This project only, and only while Pi trusts it |

`u` removes the focused key so its default applies again. `J` reveals the whole
section as stored, which is useful when a value came from a hand-edited file.
Every key and its bounds are listed in
[Configuration](../configuration.md); the screen is a curated subset, not a
separate configuration system.

## Themes

The pack ships two palettes:

- `bytefly-dark`, a GitHub-inspired dark theme designed for a near-black
  terminal background.
- `bytefly-light`, its light companion.

Installing the pack does **not** change your theme. Pick one through `/settings`
→ **Theme**, or through **Terminal → Theme** in `/bytefly settings`. The choice is
global. To follow the system's light and dark preference, set the theme to
`bytefly-light/bytefly-dark` in Pi's settings; the combined value switches
automatically.

The terminal's own background colour shows through, so a theme cannot fix a
background it was not designed for. If the contrast looks wrong, check the
terminal profile before changing the pack.

## Notifications

Notifications are off until you enable **Desktop notifications**. Once on, four
triggers can be switched independently:

| Trigger | Fires when |
|---|---|
| **Turn finished** | A full run settles and Pi waits for your next message |
| **Needs input** | The assistant opens a prompt during a run and waits for an answer |
| **Job finished** | A background job reaches a terminal state |
| **Watcher matched** | A watcher whose wake setting is on matches while the assistant is idle |

**Delivery method** can stay on **Auto**, which prefers the terminal and then
the platform, or name a mechanism: OSC 777, OSC 99, Windows toast, macOS, or
Linux `notify-send`. **Notification title** is the title of every OS
notification. An explicit method your host cannot deliver is reported by the
doctor as degraded, not silently ignored.

An aborted run is not announced: pressing `Esc` means you are already at the
keyboard. A prompt opened while the assistant is idle is a command you just
typed, so it does not notify either; only a prompt opened during a run counts as
the assistant asking.

## Health checks

`/bytefly doctor` prints a report for every enabled extension. Each gets one
verdict:

| Verdict | Meaning |
|---|---|
| `✓` | Ready |
| `!` | Works with less than it could; the text names what is missing |
| `✕` | A hard requirement is missing |

`/bytefly doctor <extension>` narrows the report. Add `refresh` to re-probe from
scratch; otherwise the report reuses the findings cached for the session.

The doctor checks hard requirements (such as `git` for worktrees, or a runnable
`pi` for subagents) and optional pieces (such as `unpdf` for PDF fetching, or a
stored WeChat login). It also reports a malformed `bytefly.json` by file and
parse error, and the age of the built-in price table when it is old enough to
warn.

The same checks run proactively at session start when **Proactive health check**
is on and the bytefly startup surface is active. A missing requirement produces a
warning instead of a failed command. The **Probe timeout** bounds each check;
raise it on a slow machine if a probe reports a timeout.

## Update checks

Once per interactive session, the pack asks Pi's package manager which configured
packages are behind, suppresses Pi's own startup update block, and posts one
notice naming `pi update --extensions`. This package's new version also marks the
startup header. The answer is cached for 24 hours, so a second session in the
same window does not repeat the request.

- `/bytefly update` re-runs the check immediately and reports the updateable
  packages, this package's version and release URL, or a skip.
- `PI_OFFLINE=1` skips the check and paints only a cached marker. It is the
  switch for the automatic update check.
- The check sends the configured package list, not your conversation. No session
  content is sent.

## Turning features off or removing the pack

### One extension, one scope

Open `/bytefly`, focus the extension, and press `Space`. The verdict changes to
off. Use `Tab` to choose whether the switch applies to the project or to
everything, then accept the reload offer so the change takes effect. A reload is
needed because extension factories run at load time.

`x` clears a project-level override, returning the extension to the global
setting. A project that is not trusted cannot be changed at project scope.

### One run only

Start Pi with a list of extension names to leave out:

```bash
PI_DISABLED_EXTENSIONS=todo,job pi
```

Names are the directory names under `extensions/`, compared
case-insensitively. Unknown names are ignored. This stops the factories from
registering for that run; it does not change your saved settings.

### Remove the pack

```bash
pi remove npm:@gavin-hu/my-pi-agent        # personal install
pi remove npm:@gavin-hu/my-pi-agent -l     # project-local install
```

Your plans, notes, snapshots, conversations, and settings are left on disk. The
[files reference](./reference.md#files-on-disk) lists them so you can delete what
you no longer want. To drop every extension for one run without removing the
package, use Pi's `--no-extensions`.

## Related

- [Configuration](../configuration.md) — every `bytefly.json` section and key, with defaults and bounds.
- [Troubleshooting](./troubleshooting.md) — what to do when a setting has no effect.
- [Reference](./reference.md#files-on-disk) — the files these settings write.

---

[← Previous: 5. Using it from WeChat](./wechat.md) · [Guide home](./README.md) · [Next: 7. Troubleshooting →](./troubleshooting.md)
