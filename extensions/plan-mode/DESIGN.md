# plan-mode — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

A read-only planning mode, modelled on Claude Code's `EnterPlanMode` /
`ExitPlanMode` pair. The model explores and proposes; the user approves; only
then does the model get write access. It is the last of the workflow trio —
`worktree` (isolation), `ask-user-question` (input), `todo` (tracking) — and it
leans on the other two rather than duplicating them.

## Non-goals

- **Not a sandbox.** Extensions share Pi's OS permissions. The bash allowlist
  and tool gating are guard rails against accidental writes, stated as such.
- **No plan files.** The plan lives in the conversation and the session, not in
  `~/.claude/plans/`; the todo list is the durable copy of the steps.
- **No progress tracker.** Plan mode does not own completion state; `todo` does.
- **No auto-execution.** Approval hands control back to the model.

## Decisions

**Two tools, not one.** `EnterPlanMode` and `ExitPlanMode` are a pair in Claude
Code: entering is consent to explore read-only, exiting is consent to act. A
single "toggle" tool cannot express "the model wants to plan but the user
declines". `enter_plan_mode` has an empty schema (the mode is the whole point),
is active by default, and asks for confirmation; `exit_plan_mode` is active only
in plan mode.

**User-driven entry is instant, model-driven entry confirmed.** `/plan`,
`Ctrl+Alt+P`, and `--plan` are the user's own action, so they take effect at
once — matching Claude Code. `enter_plan_mode` changes the mode on the user's
behalf, so it confirms first.

**`/plan <prompt>` enters and runs in one step.** An extension command receives
the raw argument string, so `/plan <prompt>` enables plan mode and sends the
rest of the line as the first user message; `before_agent_start` then injects
the read-only context for that very turn. The alternative — a `/plan` prompt
template — only injects text and cannot guarantee the gating, so the command is
the right home. `/plan` with no argument still toggles.

**Review in the transcript, decide in a menu.** The plan is the model's message,
so it is already on screen and scrollable; `exit_plan_mode` only opens the
choice. Pi's `ctx.ui.confirm()` is a non-scrollable selector, so putting a long
plan inside it pushes the buttons off-screen — the same class of problem as the
Claude Code "approve before you've read it" bug. A `select` with *Approve /
Keep planning / Refine* keeps the plan readable, works in TUI and RPC, and gives
the user a way to steer instead of only accept or reject.

**Approval seeds `todo` via `ctx.executeTool`.** The user chose tight
integration. The event bus carries no `ctx`, so a todo listener could not
refresh its widget; calling the real todo tool through `ctx.executeTool()` runs
its validation and widget sync and needs no change to `todo`. If `todo` is
absent the outcome is simply `isError`, which plan mode ignores. Only top-level
list items become steps; a leading `- [ ]`/`- [x]` checkbox or `[DONE:n]`
marker sets the seeded status, and the approval result lists the steps so the
user can see what was recorded.

**Segment-based bash allowlist.** The Pi example tests the whole command string
with allow/deny regexes, which is easily bypassed. Splitting on shell operators
(`;`, `&&`, `||`, `|`, `&`, newlines, quote-aware) and validating every
segment's first word closes the obvious holes (`ls; rm -rf x`, `ls & rm x`,
`curl … | sh`). Argument-level checks cover the rest (`find -exec`, `sed -i`
and `sed w`, redirects, command and process substitution, `curl -o`, a bare
`wget`). It is deliberately conservative and documented as a guard, not
containment.

**State as a custom entry.** `{ enabled }` is persisted with
`pi.appendEntry("plan-mode", …)` — excluded from model context, reconstructed
from `ctx.sessionManager.getBranch()` on start and tree navigation. The
`--plan` flag enables plan mode only when the branch has no persisted entry, so
a later disable survives tree navigation and `/resume`.

## Model surface

| Tool | Params | Active | Notes |
|---|---|---|---|
| `enter_plan_mode` | none | normal mode | `defaultActive` true; `ctx.ui.confirm` before entering |
| `exit_plan_mode` | `plan: string` | plan mode | `defaultActive` false; `select` → approve / keep / refine |

Tool gating is symmetric and stateless: enabling removes `write`, `edit`, and
`enter_plan_mode` and adds `exit_plan_mode`; disabling reverses exactly that.
The `tool_call` handler re-blocks writes and non-read-only bash as a second
layer, so a tool already declared in the in-flight request cannot slip through.

## Prompt and context

- `before_agent_start` injects a hidden `[PLAN MODE ACTIVE]` message while
  enabled, telling the model to explore, write the plan in its reply, then call
  `exit_plan_mode`; it may use `ask_user_question` to resolve approaches.
- `context` drops stale plan-mode messages when disabled, so `/resume` from a
  planning session does not carry the read-only instruction into later turns.
