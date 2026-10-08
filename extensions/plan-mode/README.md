# plan-mode — file-backed planning for Pi

A read-only exploration mode modelled on Claude Code's `EnterPlanMode` /
`ExitPlanMode` pair. While plan mode is on, the model can investigate and
propose, but the only thing it may write is the plan file itself. The plan is
saved under `.pi/plans` and is the artifact the user reviews and the model
executes against.

```
pi --extension ./extensions/plan-mode     # load just this extension
pi -e .                                   # load the whole @gavin-hu/my-pi-agent package
pi --plan                                 # start in plan mode
```

## What it does

- **Read-only gating, with one exception.** Tools that are not read-only are
  removed from the active set or blocked. `write` and `edit` are hidden, raw
  shell (`bash`, `powershell`) is disabled, and other mutating tools
  (`subagent`, worktree mutations, MCP tools) are blocked until you exit plan
  mode. Classification defaults to *deny* and is driven by the shared
  [`_shared/policy.ts`](../_shared/policy.ts), so unknown tools are safe by
  default and the MCP `readOnlyHint` is the only thing that opens one up — but a
  hinted tool that takes a file path is still refused unless it is a known
  reader (`_shared/path-guard.ts`). The one permitted write is the plan-mode
  control tool `write_plan`, which can only create or overwrite markdown plan
  files directly inside the plans directory — never dotfiles (such as the
  directory's own `.gitignore`) and never through a symlink.
- **Model entry point.** The model can call `enter_plan_mode` to ask for plan
  mode before a non-trivial task; the user confirms.
- **Plan files.** The model saves the plan with `write_plan`; the file lands in
  `<repo-root>/.pi/plans/<YYYY-MM-DD-HHmm>-<slug>.md` (or
  `<agent-dir>/plans` outside a repository). The plans directory is
  self-ignoring, so plan files never show up as untracked files or in
  `rewind` snapshots.
- **Reviewable plan.** `exit_plan_mode` reads the plan file back and presents
  it: a scrollable review screen in the TUI, a select dialog elsewhere. The user
  approves, keeps planning, or asks for a refinement.
- **The file is the source of truth.** On approval the model is told to follow
  the plan file's steps; refinements rewrite the same file (`write_plan` with
  `plan_path`), so the reviewed artifact is the executed artifact.
- **Steps become todos.** On approval, the plan's top-level numbered/bulleted
  steps are recorded with the `todo` tool (via `ctx.executeTool`); steps marked
  `- [x]` (or `[DONE:n]`) seed as completed, and nested sub-bullets are treated
  as notes. The approval result lists exactly what was recorded.
- **Branch-aware.** The enabled flag is a custom session entry, so `/resume` and
  `/tree` restore the right mode.
- **Manageable plans.** `/plans` browses the saved plans directory; Enter reads
  one, `d` deletes, and `u` hands one back to the model — see [Managing
  plans](#managing-plans).

## Entering plan mode

| Path | Who starts it | Confirmation |
|---|---|---|
| `enter_plan_mode` tool | the model, before a non-trivial task | `ctx.ui.confirm` |
| `/plan` | the user | immediate |
| `/plan <prompt>` | the user, with the task | immediate |
| `Ctrl+Alt+P` | the user | immediate |
| `--plan` | the user, at launch | immediate |

`/plan` with no argument toggles plan mode; `/plan <prompt>` enters it (if it is
not already on) and runs the task. `Ctrl+Alt+P` also toggles where the terminal
forwards it; because slash commands go through Pi directly, `/plan` is the
toggle that works in every terminal (for example Zed's integrated terminal,
which does not forward `Ctrl+Alt+P`). The footer shows `≡ plan` while plan mode
is on, and `≡ plan · <plan-file>` once the model has written a plan.

### `/plan <prompt>`

`/plan` with no argument toggles plan mode. With an argument it enters plan mode
(if it is not already on) and sends the rest of the line as the task, so the
first turn already runs read-only:

```
/plan add rate limiting to the public API
```

`/plan <prompt>` never disables plan mode; only the argument-less `/plan` (or
`Ctrl+Alt+P`) toggles. Saved plans are managed with `/plans` (see
[Managing plans](#managing-plans)); for a short migration period `/plan list`
and friends point at `/plans` instead of planning a task.

## Writing a plan

While plan mode is active the model has three tools:

| Tool | Purpose |
|---|---|
| `write_plan` | Save the plan: `title` (file-name slug), `content` (full markdown), optional `plan_path` to overwrite a refinement. Returns the absolute path. |
| `exit_plan_mode` | Read the plan file (`plan_path`) and present it for approval. |
| `enter_plan_mode` | Ask to enter plan mode. |

A plan file looks like `.pi/plans/2026-10-08-1530-add-rate-limiting.md`. Because
the directory holds a `.gitignore` with `*`, git and `rewind` ignore it
without touching the project's own `.gitignore`.

## Reviewing a plan

`exit_plan_mode` reads the plan file and opens a review screen in the TUI:

```
─── Plan Review · add-rate-limiting ────────────────────────────

  ## Plan
  1. Read the parser and tokenizer.
  2. Add a Token type and the lexer.
  3. Wire the parser to the new lexer.
  4. Update and add tests.
  …

  a approve · r refine · Esc keep · ↑/↓ or k/j scroll · lines 1–14 of 24 (43%)
```

- **`a` / Approve and execute** — plan mode ends, write access returns, and the
  steps are seeded into `todo`. The model executes from the plan file.
- **`r` / Refine the plan** — the plan stays on screen and an inline editor
  opens beneath it, so you can point at what you are reading. `Enter` submits
  the change (an empty buffer does nothing); `Esc` returns to the plan without
  submitting. The refinement is sent back to the model, which rewrites the plan
  file and calls `exit_plan_mode` again.
- **`Esc` / Keep planning** — stay read-only; the model is told the plan was not
  approved.

Scroll with `↑`/`↓` or `j`/`k`, `space`/`b` or `PgUp`/`PgDn` (one line of overlap), `d`/`u` for a half page, and `g`/`G` (or `Home`/`End`) for the ends; the mouse wheel scrolls too in the full-screen review. The footer shows the visible range and percent only when the plan overflows the screen. Hints are added while they fit, so a narrower terminal drops whole keys (the position, then `space`/`b` and `g`/`G`) rather than truncating one in half. Resizing the terminal keeps the same source line on top.

Dialog-capable non-TUI modes (RPC) show the same three choices as a select menu
(approve, refine, keep) plus the refine editor; cancelling that editor returns
to the select instead of being reported as "not approved". Without any UI the
tools fail with an actionable message instead of deciding for the user.

## Managing plans

Saved plans are files under `.pi/plans`, so `/plans` is a small browser over
them. It takes no arguments: in the TUI it opens the browser in the editor slot
(so it shares the dock with the other list screens, and the transcript stays
visible), and in other modes it prints the list. The plans directory is the index — there is no
registry.

```
─── Plans ─────────────────────────────────────────────────────
  4 plans · newest first

❯ ◦ add-rate-limiting · 6 steps · 2h ago · .pi/plans/2026-10-08-1530-add-rate-limiting.md
  ● redesign-jobs-ui · 12 steps · 1d ago · .pi/plans/2026-10-08-1037-redesign-jobs-ui.md
  ◦ one-line-widgets · 8 steps · 3d ago · .pi/plans/2026-10-08-1105-one-line-jobs-…
  ◦ split-worktree-modules · 9 steps · 2026-10-07 · .pi/plans/2026-10-07-2210-refactor-…

  Enter view · d delete · u use · Esc close
```

The selected row is highlighted and the rest dim; every row is clipped to the
terminal width. Rows show the plan's relative age, and the plan written in the
current session (`write_plan` / `exit_plan_mode`) is marked `●` instead of `◦`.
The browser lists only the current working directory's plans directory, newest
first.

- **`Enter` / View** — open the plan in the same scrollable read screen the
  review uses, in **browse** mode: no approve/refine keys, because viewing a
  saved plan is not approving the current task. `Esc` closes it.
- **`d` / Delete** — confirm and remove the file.
- **`u` / Use** — confirm, then hand the plan back to the model to execute in
  normal (write-capable) mode. Steps are not auto-seeded into `todo`; that only
  happens on approval.
- **`Esc`** — close the browser.

Without a TUI, `/plans` prints the list and cannot delete or use a plan, because
both actions need a confirm dialog.

## No raw shell

Plan mode does not run `bash` or `powershell`. Investigation uses the structured
`read`, `grep`, `find`, `ls`, and read-only `git` tools, plus the other
read-only tools you already have (`web_search`, `web_fetch`, `ask_user_question`,
`todo`, `goal`).

The earlier segment-based command allowlist was removed: a string parser can
never be the boundary (it modelled one shell dialect and the flags of a handful
of tools), so capability gating replaced it. If you need a shell during a plan,
exit plan mode first or wait for approval.

> This is a guard rail, not a sandbox: extensions run with Pi's OS permissions,
> so it prevents accidental writes while planning, not a hostile command. See the
> [design](DESIGN.md#direction) for the reasoning.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Wiring: tools, command, flag, shortcut, events, context injection. |
| `types.ts` | `PlanModeEntry`, `EnterPlanModeDetails`, `WritePlanDetails`, `ExitPlanModeDetails`. |
| `policy.ts` | Plan mode's read-only policy and shared prompt summary. |
| `plans.ts` | Plan-file store: slug/stamp naming, directory resolution, containment, write/read/list/remove. |
| `steps.ts` | `extractPlanSteps` (pure). |
| `runtime.ts` | Enabled state, tool gating, persistence, control-tool identity, footer status. |
| `tools.ts` | `enter_plan_mode`, `write_plan`, and `exit_plan_mode`. |
| `commands.ts` | `/plan` (enter, optional task) and `/plans` (the browser). |
| `tui.ts` | `PlanViewComponent` (scrollable plan + approve/refine/keep, or browse). |
| `list-tui.ts` | `PlanListComponent` (the `/plans` browser). |
| `../_shared/policy.ts` | Shared read-only capability policy (default-deny + `readOnlyHint`). |
| `../_shared/path-guard.ts` | Path-argument detection for the read-only backstop. |
| `../_shared/tui.ts` | Shared screen header and viewport-row helpers. |
