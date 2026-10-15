# Extensions

Every extension ships its own `README.md` under its directory with the full tool
and command surface, the Pi integration contract, and design notes. This page is
the catalog: what each one does and the names it registers. It is grouped the
same way as the root README; within a group the order matches the `pi` manifest.

## Plan and delegate

### plan

Read-only planning, modelled on Claude Code's `EnterPlanMode` / `ExitPlanMode`.
While plan mode is on, the model investigates and proposes, but the only thing
it may write is the plan file itself, saved under `.pi/plans`. Tools that are
not read-only are removed or blocked (raw shell is limited to read-only git
commands, `powershell` is blocked, and mutating tools wait), `subagent` is forced
read-only, and the policy is default-deny through `lib/policy.ts`. The plan
follows a documented outline (`# <Title>`, `## Goal`, `## Context`,
`## Approach`, `## Steps`, `## Risks`, `## Verification`); steps are `- [ ]`
checkboxes that approval seeds into `todo`, and `set_plan_steps` keeps the file
current afterward. `exit_plan_mode` presents the plan for approval, keeps
planning, or takes a refinement; the review screen jumps between headings with
`n`/`p`. Press `w` (or run `/plan review [path]`) to open the plan in a loopback
browser, leave inline comments, and save them back as `> [!REVIEW]` lines.
`/plan <prompt>` enters plan mode and sends the task in one step; `/plan` toggles
and `Ctrl+Alt+P` is the shortcut. The enabled flag is a session entry, so
`/resume` and `/tree` restore it.

Tools: `enter_plan_mode`, `write_plan`, `exit_plan_mode`, `set_plan_steps`.
Commands and flags: `/plan`, `/plan <prompt>`, `/plan review [path]`,
`Ctrl+Alt+P`, `--plan`.

[Full README](../extensions/plan/README.md)

### subagent

Delegate a task to a specialized agent running in its own `pi` process. Built-in
agents are `explorer`, `planner`, `reviewer`, `worker`, `researcher`, `tester`,
`debugger`, and `documenter`; optional user and project markdown agents add more.
Calls run single, in parallel (max 8 queued, 4 at once), or chained through a
`{previous}` placeholder. A `readOnly` mode passes only reader tools to the child.

Tool: `subagent`.

[Full README](../extensions/subagent/README.md)

### todo

A TodoWrite-style task list. The whole list is replaced on every call, each item
is `pending`, `in_progress`, or `completed`, and a persistent one-line widget
keeps the list visible (stacked under `goal` when both are loaded).

Tool: `todo`. Command: `/todos`.

[Full README](../extensions/todo/README.md)

### goal

A single persistent session objective, kept visible in a one-line widget and
restated to the model before every turn as an invisible `[SESSION GOAL]` message.
Status is `active` or `achieved`; an empty objective clears it. `/goal <prompt>`
runs an understanding loop (restate, ask any questions the model needs, confirm
or edit) and starts the run; `/goal raw` records the typed words verbatim,
`/goal set`/`edit` record without running, and `/goal done`/`clear` change state
only. Tool-set goals live in tool-result `details` and command-set goals as a
session entry, so either survives `/resume` and `/tree`.

Tool: `goal`. Command: `/goal`.

[Full README](../extensions/goal/README.md)

### question

Ask the user one or more structured questions — labelled options plus a
free-form "Other" answer — and wait for the response.

Tool: `ask_user_question`.

[Full README](../extensions/question/README.md)

### job

Run long-lived shell commands in the background. Start a job, list jobs, check
status, read a sanitized log tail, wait for completion, or kill one. A `▸ N`
chip shows running jobs and `✗ N` shows unreported failures; jobs reconcile on
session shutdown.

Tool: `job`. Command: `/jobs`.

[Full README](../extensions/job/README.md)

### watch

Tail a file or a command's merged output and match each new line against a
regular expression, with an optional exclude list and case-insensitive matching
by default. A `⊚ N` chip shows running watchers and `! N` shows unreported
matches; matching lines are sanitized, alerted, and reported to the model at the
next turn, or wake a turn immediately when a watcher was added `wake: true`.
Watchers are session-only and stopped on session shutdown.

Tool: `watch`. Command: `/watch`.

[Full README](../extensions/watch/README.md)

## Keep your work safe

### worktree

Let one Pi session work inside an isolated `git worktree` on its own branch, and
manage the worktrees it creates. The model keeps calling `read` / `write` /
`edit` / `bash` with ordinary relative paths; only the effective root changes.
`exit_worktree` returns to the main checkout — a clean worktree is removed, and
one with uncommitted changes or new commits is never discarded silently. Cleanup
refuses to throw work away, and path and shell escapes are guarded.

Tools: `enter_worktree`, `exit_worktree`, `prune_worktrees`, `list_worktrees`.
Commands and flags: `/worktree*`, `--worktree <name>`.

[Full README](../extensions/worktree/README.md)

### rewind

Automatic per-prompt snapshots stored under `refs/pi/rewind`, plus `/rewind` to
restore code, conversation, or both. A `↺ N` status chip shows the available
snapshots. Parallel tool calls in one prompt share a single snapshot.

Command: `/rewind`.

[Full README](../extensions/rewind/README.md)

### memory

Durable cross-session notes as human-editable markdown: global notes under the
agent directory, project notes under the repo root's `.pi/`. Add, update, or
forget notes, and list what is stored; an active note set is injected as a
hidden `[MEMORY]` context before each run. `/memory` opens a picker to add,
edit, or forget a single note (and otherwise lists, edits, or clears them).

Tool: `memory`. Command: `/memory`.

[Full README](../extensions/memory/README.md)

## Reach the world

### web-access

Web access with two tools. `web_search` searches through a pluggable provider —
keyless DuckDuckGo by default, with optional self-hosted SearXNG or a keyed
Brave search. `web_fetch` GETs or POSTs a URL and returns readable text, with
paging, `find`, per-hop SSRF checks against private/internal addresses, and
optional PDF extraction. Configuration lives in the `web-access` section of
`bytefly.json`.

Tools: `web_search`, `web_fetch`.

[Full README](../extensions/web-access/README.md)

### file-browse

`/browse` starts a read-only local HTTP server bound to `127.0.0.1` and opens a
two-pane browser tree rooted at the working directory: listings, a rendered
Markdown preview (heading anchors and an on-this-page outline, styled tables
and images), sortable listings, copy and wrap, image thumbnails,
per-language icons, a filter, and a fuzzy quick-open palette. No dependencies,
with a `◉ <port>` status chip while it runs.

Command: `/browse`.

[Full README](../extensions/file-browse/README.md)

### document

`read_doc` extracts plain text from a local PDF, DOCX, DOC, ODT, RTF, or XLSX in
process, paged with `startIndex` / `maxChars` and confined to the effective
working directory.

Tool: `read_doc`.

[Full README](../extensions/document/README.md)

### file-open

Open or reveal a file or directory in the OS-native application with
`/open <path>` (or `/open -r <path>` for the file manager), plus the codemode
`open_path` tool.

Tool: `open_path`. Command: `/open`.

[Full README](../extensions/file-open/README.md)

### wechat

A thin bridge to WeChat over the Weixin iLink bot API. The live Pi session is
the agent: inbound text, images (as model image content), and files (saved and
referenced by path) become a user turn, and the reply is sent back with a typing
indicator. The bridge starts automatically once an account is stored. `/wechat`
opens a control screen (`login`, `new`, `status`, `logout`, `help`) in the TUI and
prints a one-line summary elsewhere. The `send_wechat` tool messages the
account owner only.

Tool: `send_wechat`. Command: `/wechat`.

[Full README](../extensions/wechat/README.md)

## Chrome and upkeep

### bytefly

The themed TUI chrome and the package's diagnostics surface. It draws the
startup header (a two-tone nameplate with the agent and chrome identities, drawn
from the active theme's tokens), a compact, width-adaptive two-line footer (pwd
+ session name + git branch/worktree + browse chip, then context gauge + usage +
mode/alert + model + thinking level), and the labeled `╌╌╌ turn N ╌╌╌` rule
between completed turns.
DeepSeek is priced out of the box from its published yuan rates and peak tariff,
and `bytefly.json` adds or overrides per-model rates with an optional
peak/off-peak schedule. It also owns the `/bytefly` extension screen — a
keyboard-driven docked list of every resolved Pi extension, one row per
extension carrying its enable checkbox and its worst-severity health, with the
focused extension's findings underneath. `Space` toggles the focused extension
by writing `settings.json`, `Enter` expands the detail pane, `Tab` switches
Global/Project scope, and `r` re-probes. `/extensions` and
`/doctor [extension] [refresh]` are aliases for the same screen, and every other
mode prints the grouped listing or one extension's full findings. The read-only
`run_doctor` tool returns the same report. An opt-in notify capability raises an
OS notification when a run or a background job finishes or the agent asks for
input, configured through the `notify` section of `bytefly.json`, for
unattended runs.

Tools: `run_doctor`. Commands: `/bytefly`, `/extensions`, `/doctor`.

[Full README](../extensions/bytefly/README.md)

### Themes

| Theme | Description |
|---|---|
| [`bytefly-dark`](../themes/bytefly-dark.json) | A GitHub-inspired dark palette: deep blue-black canvas, cool gray text, blue accent, green/red/yellow status colors, purple/pink operators. |
| [`bytefly-light`](../themes/bytefly-light.json) | The light companion: white canvas with GitHub light accents, for `bytefly-light/bytefly-dark` auto-switching. |

Select a theme through `/settings` → **Theme**, or set
`"theme": "bytefly-light/bytefly-dark"` in settings.
