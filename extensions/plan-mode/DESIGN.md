# plan-mode — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

A read-only planning mode, modelled on Claude Code's `EnterPlanMode` /
`ExitPlanMode` pair. The model explores and proposes; the user approves; only
then does the model get write access. The plan is saved to `.pi/plans` and is
the artifact the user reviews and the model executes, so the only write
during planning is the plan file itself. It is the last of the workflow trio —
`worktree` (isolation), `ask-user-question` (input), `todo` (tracking) — and it
leans on the other two rather than duplicating them.

## Non-goals

- **Not a sandbox.** Extensions share Pi's OS permissions. The tool gating is a
  guard rail against accidental writes, stated as such.
- **No plan manager.** Plan-mode writes and reads plan files but does not list
  or browse them; a `/plans` command is future work.
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

**Review the file, decide in a screen (or a menu).** The plan is a file, so it
is the artifact already on screen and scrollable in the transcript. In the TUI
`exit_plan_mode` opens `PlanReviewComponent`, a scrollable, width-safe view of
the file with approve/refine/keep in the footer; dialog-capable non-TUI modes
fall back to Pi's `select` menu plus the refine editor. Pi's `ctx.ui.confirm()`
is a non-scrollable selector, so putting a long plan inside it pushes the
buttons off-screen — the same class of problem as the Claude Code "approve
before you've read it" bug. A `select` (plus the review screen in the TUI) keeps
the plan readable and gives the user a way to steer instead of only accept or
reject.

**The model writes the plan file through `write_plan`.** Plan mode is not
strictly read-only: it permits exactly one write, a dedicated tool that takes a
short title and markdown and can only create or overwrite files inside the
resolved plans directory. It is not the builtin `write`, so the capability
policy and the path backstop stay intact; the `tool_call` guard exempts the
control tool only when the registered tool is this extension's own, matched by
source path, so a same-named tool from another extension cannot borrow the
exemption. The plans directory is self-ignoring (a `.gitignore` of `*`), so git
and `checkpoint` leave plan files alone without editing the project.

**Approval seeds `todo` via `ctx.executeTool`.** The user chose tight
integration. The event bus carries no `ctx`, so a todo listener could not
refresh its widget; calling the real todo tool through `ctx.executeTool()` runs
its validation and widget sync and needs no change to `todo`. If `todo` is
absent the outcome is simply `isError`, which plan mode ignores. Only top-level
list items become steps; a leading `- [ ]`/`- [x]` checkbox or `[DONE:n]`
marker sets the seeded status, and the approval result lists the steps so the
user can see what was recorded.

**No raw shell.** The Pi example restricted `bash` with allow/deny regexes; this
version went further with a segment-based allowlist, but a string parser can
never be the boundary — the first review found both bypasses (`find -fprintf`,
`>& file`, `python3 -c … --version`) and a platform hole (`powershell` was never
guarded). Plan mode now disables raw shell entirely: `bash` and `powershell` are
denied, and exploration uses the structured `read`/`grep`/`find`/`ls` tools plus
a read-only `git` tool (`status`/`diff`/`log`/`show`/`branch`) so losing the shell
does not cost git visibility. The old analyzer is gone rather than left as dead
code.

**State as a custom entry.** `{ enabled }` is persisted with
`pi.appendEntry("plan-mode", …)` — excluded from model context, reconstructed
from `ctx.sessionManager.getBranch()` on start and tree navigation. The
`--plan` flag enables plan mode only when the branch has no persisted entry, so
a later disable survives tree navigation and `/resume`.

## Model surface

| Tool | Params | Active | Notes |
|---|---|---|---|
| `enter_plan_mode` | none | normal mode | `defaultActive` true; `ctx.ui.confirm` before entering |
| `write_plan` | `title`, `content`, optional `plan_path` | plan mode | `defaultActive` false; writes `<repo>/.pi/plans/YYYY-MM-DD-HHmm-<slug>.md` (agent dir outside a repo) |
| `exit_plan_mode` | `plan_path` | plan mode | `defaultActive` false; reads the file, then review screen (TUI) or select (RPC) → approve / keep / refine |

Tool gating is symmetric and stateless: enabling removes every active tool the
policy does not consider read-only and adds `exit_plan_mode`; disabling restores
exactly what it hid. The `tool_call` handler re-checks every call through the
same policy as a second layer, so a tool already declared in the in-flight
request cannot slip through.

## Prompt and context

- `before_agent_start` injects a hidden `[PLAN MODE ACTIVE]` message while
  enabled, telling the model to explore, save the plan with `write_plan`, then
  call `exit_plan_mode` with the returned path; the file is the source of truth
  and it may use `ask_user_question` to resolve approaches.
- `context` drops stale plan-mode messages when disabled, so `/resume` from a
  planning session does not carry the read-only instruction into later turns.

## Direction

Plan mode is a read-only guarantee. Reaching it took replacing the string
parser that used to gate `bash`: it modelled one shell dialect, the flags of a
handful of tools, and a hardcoded list of mutators, which is why the first
review found both bypasses (`find -fprintf`, `>& file`, `python3 -c … --version`)
and a platform hole (the built-in `powershell` tool was never guarded). The
result is capability gating at the tool boundary, with raw shell removed.

1. **Capability policy, not a mutator list (implemented).** A shared
   [`_shared/policy.ts`](../_shared/policy.ts) classifies every tool call as
   read-only or mutating. It defaults to *deny*: a tool is allowed only when it
   is a known structured reader or carries the MCP `readOnlyHint`. That makes
   the policy correct for tools it has never seen — `bash`, MCP servers, future
   extension tools — instead of relying on `write`/`edit` being the only
   mutators. Plan mode blocks mutating tools and filters them out of the active
   set, restoring exactly what it hid on exit.
2. **Read-only is inherited, not local (resolved by blocking).** A read-only
   session must not escalate through delegation. Plan mode default-denies
   `subagent`, so a read-only turn cannot spawn write-capable work at all;
   there is nothing to inherit. Letting a read-only session delegate to a
   read-only agent is a possible future enhancement, not a safety gap.
3. **Constrain the shell instead of parsing it (implemented).** Plan mode no
   longer runs raw shell: `bash`/`powershell` are denied, and exploration uses
   the structured `read`/`grep`/`find`/`ls` tools plus the read-only `git` tool
   (`extensions/git`). A future read-only mode that needs a shell should
   delegate it to an isolated backend (Gondolin, or a read-only mounted
   container) rather than re-introducing a parser.
4. **Path-level backstop (implemented).** A shared
   [`_shared/path-guard.ts`](../_shared/path-guard.ts) spots path-like arguments
   in a tool call. A `readOnlyHint` is only a claim, so while planning a tool
   that takes a file path is blocked unless it is a known plan-safe reader — an
   unclassified or mislabeled mutating tool cannot write through a path
   argument.

The boundary is now: (1) capability gating, (3) no raw shell, and (4) a path
check on top, so (2) holds because delegation is blocked. Plan mode adds one
narrow, audited write — the plan artifact, through `write_plan` into the plans
directory — so the guarantee is "read-only except the plan file". The one-line
rule: **enforce capabilities at the tool boundary; do not parse commands to
decide what is safe.** The remaining idea — read-only delegation — is a feature,
not a hole.
