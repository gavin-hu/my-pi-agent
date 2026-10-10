# plan — file-backed planning for Pi

A read-only exploration mode modelled on Claude Code's `EnterPlanMode` /
`ExitPlanMode` pair. While plan mode is on, the model investigates and proposes,
but the only thing it may write is the plan file itself. The plan is saved under
`.pi/plans`; the user reviews that file, and it is the artifact the model
executes.

```bash
pi --extension ./extensions/plan   # load just this extension
pi -e .                            # load the whole @gavin-hu/my-pi-agent package
pi --plan                          # start in plan mode
```

## What it does

- **Read-only gating, with one exception.** Tools that are not read-only are
  removed from the active set or blocked. `write` and `edit` are hidden, raw
  shell is limited to read-only git commands through `bash` (chained with
  `&&`/`;`), `powershell` is blocked outright, and other mutating tools (worktree
  mutations, MCP tools) are blocked until you exit plan mode. `subagent` stays
  active but is forced read-only. The only permitted write is the plan control
  tool `write_plan`, which can only create or overwrite markdown plan files
  directly inside the plans directory — never dotfiles and never through a
  symlink. Classification defaults to *deny* and is driven by the shared
  [`lib/policy.ts`](../../lib/policy.ts), so unknown tools are safe by default
  and the MCP `readOnlyHint` is the only thing that opens one up. A refused
  shell command explains the fix: the working directory is already the project
  root (so `cd` is unnecessary), and files belong to the `read`, `grep`, `find`,
  and `ls` tools.
- **Model entry point.** The model can call `enter_plan_mode` to ask for plan
  mode before a non-trivial task; the user confirms.
- **Plan files.** The model saves the plan with `write_plan`; the file lands in
  `<repo-root>/.pi/plans/<YYYY-MM-DD-HHmm>-<slug>.md` (or `<agent-dir>/plans`
  outside a repository). The plans directory is self-ignoring, so plan files
  never show up as untracked files or in `rewind` snapshots.
- **Reviewable plan.** `exit_plan_mode` reads the plan file back and presents
  it for approval. The user approves, keeps planning, or asks for a refinement.
- **The file is the source of truth.** On approval the model follows the plan
  file's steps; refinements rewrite the same file (`write_plan` with
  `plan_path`), so the reviewed artifact is the executed artifact.
- **Steps become todos.** On approval, the plan's top-level numbered/bulleted
  steps are recorded with the `todo` tool (via `ctx.executeTool`); steps marked
  `- [x]` (or `[DONE:n]`) seed as completed, and nested sub-bullets are treated
  as notes.
- **Branch-aware.** The enabled flag is a custom session entry, so `/resume` and
  `/tree` restore the right mode.

## Tools

| Tool | Active | Purpose |
|---|---|---|
| `enter_plan_mode` | normal mode | Ask to enter plan mode; empty schema, confirmed with `ctx.ui.confirm`. |
| `write_plan` | plan mode | Save the plan: `title` (file-name slug), `content` (full markdown), optional `plan_path` to overwrite a refinement. Returns the absolute path. |
| `exit_plan_mode` | plan mode | Read the plan file (`plan_path`) and present it for approval. |

### Commands and flags

| Path | Who starts it | Confirmation |
|---|---|---|
| `enter_plan_mode` tool | the model, before a non-trivial task | `ctx.ui.confirm` |
| `/plan` | the user | immediate |
| `/plan <prompt>` | the user, with the task | immediate |
| `Ctrl+Alt+P` | the user | immediate |
| `--plan` | the user, at launch | immediate |

`/plan` with no argument toggles plan mode; `/plan <prompt>` enters it (if it is
not already on) and sends the rest of the line as the task, so the first turn
already runs read-only:

```bash
/plan add rate limiting to the public API
```

`/plan <prompt>` never disables plan mode; only the argument-less `/plan` (or
`Ctrl+Alt+P`) toggles. Because slash commands go through Pi directly, `/plan` is
the toggle that works in every terminal (for example Zed's integrated terminal,
which does not forward `Ctrl+Alt+P`). The footer shows `⋮ plan` while plan mode
is on, and `⋮ plan · <plan-file>` once the model has written a plan.

## Behaviour by mode

The review screen is TUI-only. `exit_plan_mode` opens `PlanViewComponent`: a
scrollable, width-safe view of the plan with approve/refine/keep in the footer.
`a` ends plan mode, restores write access, and seeds `todo`; `r` keeps the plan
mounted and opens an inline editor beneath it (`Enter` submits, an empty buffer
does nothing, `Esc` returns to the plan); `Esc` keeps planning and tells the
model the plan was not approved. Scroll with `↑`/`↓` or `j`/`k`, `space`/`b` or
`PgUp`/`PgDn`, `d`/`u`, `g`/`G`, and the mouse wheel. When the plan overflows,
the visible range and percent get their own dim row above the hints; hints are
dropped whole as the terminal narrows, and each footer leads with its safe exit
(`Esc keep planning` in the review, `Esc back to plan` in the inline editor) so
the exit survives even when only one hint fits.

Dialog-capable non-TUI modes (RPC) show the same three choices as a select menu
plus the refine editor; cancelling the editor returns to the select instead of
being reported as "not approved". A WeChat turn takes the same dialog path and
is answered over WeChat, even though the session is in TUI mode: the choice
comes from `askHuman(ctx, { custom, dialogs, file, body })` in
`lib/interaction.ts`, not from `ctx.mode`. A remote turn also receives the plan
**file** first (falling back to the plan text if the upload fails) so the whole
plan is reviewable there; RPC has no channel and still sees only the choices.
Without any UI the tools fail with an actionable message instead of deciding for
the user.

### Transcript

The three tool rows reuse the transcript component, and `exit_plan_mode`
separates the plan body from its header with a blank line; the collapse hint
binds to `app.tools.expand` (`ctrl+o` by default).

```
enter_plan_mode requested plan mode
✓ Plan mode enabled
```

```
write_plan Add rate limiting
✓ Saved plan .pi/plans/2026-10-09-1809-add-rate-limiting.md
```

```
exit_plan_mode submitted a plan
✓ Plan approved
.pi/plans/2026-10-09-1809-add-rate-limiting.md

# Add rate limiting
1. Add a token bucket …

… 12 more lines (ctrl+o to expand)
```

## Security

Plan mode is a **guard rail, not a sandbox**: extensions run with Pi's OS
permissions, so it prevents accidental writes while planning, not a hostile
command. The read-only guarantee is layered:

- **Capability policy.** A tool is allowed only when it is a known structured
  reader or declares the MCP `readOnlyHint`; `write`, `edit`, and unknown
  mutators are denied.
- **Path backstop.** A `readOnlyHint` is only a claim, so a tool that takes a
  file path is refused unless it is a known plan-safe reader. `path-guard.ts`
  scans nested arguments and path-shaped values, not just fixed top-level keys.
- **Control-tool identity.** The `tool_call` guard exempts `write_plan` /
  `exit_plan_mode` only when the registered tool is this extension's own,
  matched by source path, so a same-named tool from another extension cannot
  borrow the exemption.
- **Contained writes.** `write_plan` only writes markdown non-dotfiles whose
  real parent resolves inside the plans directory.
- **Sanitized model text.** The plan file is model-authored, so `exit_plan_mode`
  strips control characters from the plan body before rendering it in the
  transcript and in non-TUI notices; a plan file cannot drive the terminal.

## Read-only git shell

Plan mode does not run a general shell. `bash` stays active only so the model
can run **read-only git commands** — for example `git status`,
`git diff --stat`, `git log --oneline`, `git show HEAD`, or `git branch -a`.
Several may be chained with `&&` or `;` in one call, but every segment must
itself be a read-only git command, so a chain only combines allowed reads.
Anything else (a non-git command, a mutating git subcommand, a piped or
redirected command, substitution, or a conditional `||`) is blocked by a
conservative allowlist in `git-bash.ts`. `powershell` is not allowed at all, so
plan mode uses Git Bash on native Windows: the same read-only git commands work
there, and a backslash before an ordinary character is accepted as a Windows
path separator while a backslash that escapes a metacharacter is still refused.
Everything else uses `read`, `grep`, `find`,
`ls`, and the other read-only tools already available (`web_search`,
`web_fetch`, `ask_user_question`, `todo`, `goal`).

```bash
git status && git diff --stat     # allowed: two read-only git commands
git status; git log --oneline -5  # allowed
git diff -- extensions\plan      # allowed: a Windows path separator
git status && rm -rf x            # blocked: the second segment is not git
git status | sh                   # blocked: pipes are never allowed
git diff > out.patch              # blocked: redirection is a write
```

A string parser can never be the boundary, so capability gating replaced the
earlier segment-based command allowlist. The git shell guard is a narrow,
deliberate exception — an allowlist over read-only git command shapes, not a
general shell parser. If you need anything else during a plan, exit plan mode
first or wait for approval.

## Read-only delegation

While planning, `subagent` stays available but every call is **forced
read-only**. Plan mode sets `readOnly: true` on the call in the `tool_call`
guard, and `subagent` in turn gives each spawned agent a reader-only `--tools`
list (`read`, `grep`, `find`, `ls`, `web_search`, `web_fetch`). The child
process enforces it, so a delegated `explorer`, `researcher`, or even `worker`
cannot write, edit, or run a shell — regardless of its prompt or an external
agent file that overrides it.

```jsonc
// The model just calls subagent; plan mode supplies the readOnly flag.
{ "agent": "explorer", "task": "Map how the plan extension gates tools" }
```

- A `subagent` whose registered schema does not declare `readOnly` is refused
  (default-deny), so an old or unrelated tool cannot be run read-write while
  planning.
- The delegated run keeps its own isolated context window, so broad exploration
  does not fill the planning session.
- `readOnly` is also a normal `subagent` parameter; outside plan mode a caller
  may set it to run any agent read-only on purpose.

## Limitations

- PowerShell is not available while planning. On native Windows the shell is
  Git Bash (`bash`), which must be installed for any shell command to run.
- The read-only guarantee is a guard rail against accidental writes, not a
  security boundary (see [Security](#security)).
- The plans directory is the only index; there is no registry and no persisted
  plan metadata.

## Non-goals

- **Not a sandbox.** Extensions share Pi's OS permissions.
- **No progress tracker.** Plan mode does not own completion state; `todo`
  does.
- **No auto-execution.** Approval hands control back to the model.

## Pi integration

| Integration point | How |
|---|---|
| Tools | `enter_plan_mode`, `write_plan`, `exit_plan_mode` registered with `executionMode: "sequential"`. `enter_plan_mode` is active normally with `readOnlyHint: true`; `write_plan` (`readOnlyHint: false`) and `exit_plan_mode` (`readOnlyHint: true`) are `defaultActive: false`. Each returns typed `details` (`EnterPlanModeDetails`, `WritePlanDetails`, `ExitPlanModeDetails`); no `outputSchema`/`structuredContent`. |
| Commands and flags | `/plan` (toggle, or enter and send a task), `--plan` launch flag, `Ctrl+Alt+P` shortcut. |
| State | Enabled flag persisted with `pi.appendEntry("plan-mode", { enabled })` and rebuilt from `ctx.sessionManager.getBranch()`; the last plan path lives in runtime memory for the footer chip. |
| Hooks | `tool_call` blocks non-read-only calls and forces `subagent` read-only; `before_agent_start` injects the hidden `[PLAN MODE ACTIVE]` context; `context` keeps only the newest plan context while enabled and drops stale ones otherwise. |
| Lifecycle | `session_start`/`session_tree` restore state; `session_shutdown` clears the footer status. |

## Design notes

- **Two tools, not one.** `EnterPlanMode`/`ExitPlanMode` are a pair: entering is
  consent to explore read-only, exiting is consent to act. A single toggle tool
  cannot express "the model wants to plan but the user declines".
- **User entry is instant, model entry confirmed.** `/plan`, `Ctrl+Alt+P`, and
  `--plan` are the user's own action and take effect at once; `enter_plan_mode`
  changes the mode on the user's behalf, so it confirms first.
- **Review the file, decide in a screen.** The plan is a file, so it is the
  artifact already on screen. `ctx.ui.confirm()` is a non-scrollable selector
  that pushes buttons off-screen for a long plan, so the TUI gets a scrollable
  review screen and dialog-capable modes get a `select` plus editor.
- **`write_plan` is the only write.** It is not the builtin `write`, so the
  capability policy and path backstop stay intact; a `plan_path` must name a
  markdown non-dotfile whose real parent resolves inside the plans directory,
  so symlinks and the directory's own `.gitignore` are never writable targets.
- **Approval seeds `todo` via `ctx.executeTool`.** The event bus carries no
  `ctx`, so a listener could not refresh the todo widget; calling the real tool
  runs its validation and widget sync and needs no change to `todo`. Only
  top-level list items become steps.
- **Direction: enforce capabilities at the tool boundary.** (1) A shared
  default-deny policy classifies every call as read-only or mutating instead of
  maintaining a mutator list. (2) Read-only delegation is enforced in the child
  process through `--tools`, not by trusting the agent name or prompt. (3) Raw
  shell is removed except the narrow read-only git allowlist in `git-bash.ts`;
  no general shell parser. (4) A recursive path guard blocks hint-carrying tools
  that take a file path unless they are known plan-safe readers.
- **State is a custom entry.** `{ enabled }` is excluded from model context and
  reconstructed on start and tree navigation; the `--plan` flag only applies
  when the branch has no persisted entry, so a later disable survives
  `/resume`.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Wiring: tools, command, flag, shortcut, events, context injection. |
| `types.ts` | `PlanModeEntry`, `EnterPlanModeDetails`, `WritePlanDetails`, `ExitPlanModeDetails`. |
| `policy.ts` | Plan mode's read-only policy, the shared prompt summary, and the bash-refusal guidance. |
| `git-bash.ts` | `checkReadOnlyGit`: the pure allowlist that restricts `bash` to read-only git commands. |
| `plans.ts` | Plan-file store: slug/stamp naming, directory resolution, containment, write/read. |
| `steps.ts` | `extractPlanSteps` (pure). |
| `runtime.ts` | Enabled state, tool gating, persistence, control-tool identity, footer status. |
| `tools.ts` | `enter_plan_mode`, `write_plan`, and `exit_plan_mode`. |
| `commands.ts` | `/plan` (enter, optional task). |
| `tui.ts` | `PlanViewComponent` (scrollable plan + approve/refine/keep). |
| `path-guard.ts` | Recursive path-argument detection for the read-only backstop. |
| `../../lib/policy.ts` | Shared read-only capability policy (default-deny + `readOnlyHint`). |
| `../../lib/tui.ts` | Shared screen header and viewport-row helpers. |
