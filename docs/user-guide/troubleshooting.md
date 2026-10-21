# 7. Troubleshooting

Most problems with the pack are one of five things: an extension is disabled, a
runtime requirement is missing, a screen needs the interactive terminal, a
setting is overridden at another scope, or a session is in a mode that refuses
the action. This chapter gives you a triage routine, then a symptom table, then
the places to ask for help.

**Use this chapter when** a feature is missing, a command refuses, a screen does
not open, or something changed after an update.

## Triage

Work through these in order. Each step is cheap and rules out a large class of
problems.

1. **Run the doctor.**

   ```text
   /bytefly doctor
   ```

   `✕` marks a missing hard requirement and `!` a reduced feature; a row with
   neither glyph is fine. The report names the missing piece and usually the
   install command. Add `refresh` to ignore the session cache and probe again.

2. **Check that the extension is on.** Open `/bytefly` and find its row. A
   project-level switch can differ from the global one; press `Tab` to see both.
   `PI_DISABLED_EXTENSIONS` can also leave an extension out for one run.

3. **Check the mode.** Full-screen panels, widgets, and status chips need Pi's
   interactive terminal interface. In RPC, JSON, or print mode, most commands
   still work but print a report instead. An action described as TUI-only will
   not appear at all.

4. **Check plan mode.** If the footer shows `≡ plan`, mutating actions are
   refused by design: `/check`, `/review`, worktree changes, and file edits all
   wait for approval. Approve the plan or turn plan mode off with `/plan`.

5. **Check the scope and the reload.** A project value overrides a global value.
   Some changes need a reload before the extension factories see them; the
   control centre offers one after a change.

6. **Read the specific report.** `/wechat doctor`, `/memory doctor`, the job log,
   or the failure detail usually names the cause more precisely than a general
   symptom.

## Symptom and cause

| Symptom | Likely cause | What to do |
|---|---|---|
| `/bytefly` is not a command | The package did not load | Check `pi list`, reinstall, restart Pi |
| A feature's row says `off` | Disabled globally or for this project | Enable it in `/bytefly`; check the scope with `Tab` |
| A row says `✕` or `!` | A runtime piece is missing or degraded | Expand the row or run `/bytefly doctor <extension>` |
| A full-screen panel does not open | Not an interactive TUI session, or the extension is off | Use the text-mode report, or start an interactive session |
| A setting has no effect | Project override, app-level row, or no reload yet | Check the scope and origin on the Settings row, reload after saving |
| A configuration file is ignored | Malformed JSON | The doctor names the file and parse error; fix or remove the file |
| `/check` says no command was found | No detector matched the project | Set `check.command` in `bytefly.json` |
| `/check` refuses immediately | Plan mode is on | Approve the plan first |
| Worktree or rewind refuses | `git` is missing, or the project is not a git repository | Install `git`, run from a tracked project; note the report |
| A file the assistant wrote is gone | It was written inside a worktree | `/worktree` shows the active folder; enter it or exit with the work |
| A subagent cannot start | No runnable `pi` on `PATH`, or the run timed out | Check the doctor; the run's error names the limit |
| `/open` does nothing | Not an interactive session, or the path is missing | Run it in the TUI; the command reports a missing path |
| The browser page will not open | The server is not running, or a pinned port is busy | `/browse status`; the port conflict is reported rather than silently changed |
| Web fetch refuses a URL | A private or internal address, an unsupported scheme, or a redirect into one | Use a public `http`/`https` URL; the error names the refusal |
| A PDF URL is refused | The optional PDF reader is not installed | Install `unpdf`, or fetch an HTML version |
| WeChat stopped answering | The login expired, or polling is paused | See [WeChat stopped answering](#wechat-stopped-answering) |
| The update check is noisy or blocked | A new release exists, or the network is unavailable | `/bytefly update`, or set `PI_OFFLINE=1` |
| The theme looks wrong | The terminal background is not the one the theme was designed for | Change the terminal profile, or pick the other theme |
| A command name is not recognized | A typo, or the extension that owns it is disabled | Check the [command index](./reference.md#commands); enable the extension |

### WeChat stopped answering

1. Run `/wechat doctor`. It reports the connection state, token age, last poll,
   poller lock, per-peer queue, and recent failures.
2. If the token expired, `/wechat login` scans a new QR code. The footer chip
   `✆ wechat expired` clears when the bridge reconnects.
3. If polling is paused, `/wechat resume` reacquires the account lock.
4. If another Pi process holds the lock, pause this one or stop the other. Two
   processes polling one account steal each other's messages.
5. If a peer's turn is stuck, open `/wechat` and press `s` on that conversation,
   or run `/wechat stop <peer>`.
6. If the bot is still quiet, check `/wechat status` for a refused sender. Only
   the owner and allowed peers are answered.

### A tool is missing from the assistant's choices

The tool list is rebuilt when an extension loads. A tool that disappeared after
a toggle needs the reload the control centre offers. A tool that was never
there usually belongs to a disabled extension, or to a package that is not
installed in a subagent's own configuration (a child `pi` does not inherit `-e`
flags).

### A plan or review looks stale

A plan file is the source of truth; reopen it with `/plan list` or
`/plan review`. `/review` compares against the snapshot taken before the latest
prompt on the active branch, so a turn executed on another branch is not part of
the comparison.

## Frequently asked questions

**Does installing change my Pi or my theme?**
No file in Pi is modified. The pack adds tools, transcript chrome, and one update
check per session; it does not select a theme. The startup header is opt-in.

**Does it work offline?**
All local features do. Web access and the update check need a network; set
`PI_OFFLINE=1` to skip the update check. The WeChat bridge needs WeChat's
service.

**Does it send my code or conversation anywhere?**
The pack sends nothing on its own. A web search or fetch sends that request; the
WeChat bridge sends messages after you log in; the update check sends the package
list. [Cost and network](./getting-started.md#cost-and-network) has the table.

**Can I use only one feature?**
Yes. Every extension is independent. Disable the rest in `/bytefly`, or start
with `PI_DISABLED_EXTENSIONS`.

**Will it work in a monorepo or from a subdirectory?**
Yes. Paths resolve against the effective working directory. The project memory
store is anchored at the repository root, so it stays stable from a
subdirectory; the file browser and the file reader use the effective root.

**Can several sessions run at once?**
Yes, with two exceptions: two WeChat bridges cannot poll one account at the same
time, and a worktree takes a lock while it is active. Background jobs are shared
between sessions in the same project.

**How do I start over with the settings?**
Remove the key with `u` on its Settings row, or delete the project's
`.pi/bytefly.json`. A malformed file is ignored, so deleting it is safe; the
doctor reports the failure rather than the session crashing.

**How do I remove the pack?**
`pi remove npm:@gavin-hu/my-pi-agent`. Your plans, notes, snapshots,
conversations, and settings remain on disk. See
[Turning features off or removing the pack](./settings-and-customization.md#turning-features-off-or-removing-the-pack).

## Getting help

If the steps above do not solve it, gather these before you ask:

1. The output of `/bytefly doctor`. It is the single most useful attachment.
2. `pi --version`, the pack version from `pi list` or the startup header, and
   your operating system.
3. The mode you were in: interactive terminal, RPC, JSON, or print.
4. The exact command or prompt, what you expected, and what happened. A minimal
   reproduction is better than a description.
5. Any error text, with secrets removed.

Open an issue at
[github.com/gavin-hu/my-pi-agent/issues](https://github.com/gavin-hu/my-pi-agent/issues).
Feature requests are welcome there too; the [roadmap](../../ROADMAP.md) shows
what is already planned.

> **Do not paste secrets.** Remove API keys, WeChat credentials, tokens, private
> file contents, and anything from `<agent-dir>/wechat/credentials.json` or
> `state.json`. A doctor report is safe to share; a configuration file may not
> be.

## Related

- [Configuration](../configuration.md) — every setting and its default.
- [Security](../security.md) — what the network and local web surfaces can reach.
- [Development](../development.md) — reporting a bug against a checkout, and the checks a change must pass.

---

[← Previous: 6. Settings and customization](./settings-and-customization.md) · [Guide home](./README.md) · [Next: 8. Reference →](./reference.md)
