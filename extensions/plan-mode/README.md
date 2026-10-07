# plan-mode — read-only planning for Pi

A read-only exploration mode modelled on Claude Code's `EnterPlanMode` /
`ExitPlanMode` pair. While plan mode is on, the model can investigate and
propose, but cannot modify files until the user approves the plan.

```
pi --extension ./extensions/plan-mode     # load just this extension
pi -e .                                   # load the whole @gavin-hu/my-pi-agent package
pi --plan                                 # start in plan mode
```

## What it does

- **Read-only gating.** Tools that are not read-only are removed from the
  active set or blocked. `write` and `edit` are hidden, raw shell (`bash`,
  `powershell`) is disabled, and other tools that mutate (`subagent`,
  worktree mutations, MCP tools) are blocked until you exit plan mode. Classification
  defaults to *deny* and is driven by the shared
  [`_shared/policy.ts`](../_shared/policy.ts), so unknown tools are safe by
  default and the MCP `readOnlyHint` is the only thing that opens one up — but a
  hinted tool that takes a file path is still refused unless it is a known
  reader (`_shared/path-guard.ts`). The exact allow and deny lists live in
  `policy.ts`.
- **Model entry point.** The model can call `enter_plan_mode` to ask for plan
  mode before a non-trivial task; the user confirms.
- **Reviewable plan.** The model writes the plan in its reply, then calls
  `exit_plan_mode`; the user approves, keeps planning, or asks for a refinement.
- **Steps become todos.** On approval, the plan's top-level numbered/bulleted
  steps are recorded with the `todo` tool (via `ctx.executeTool`); steps marked
  `- [x]` (or `[DONE:n]`) seed as completed, and nested sub-bullets are treated
  as notes. The approval result lists exactly what was recorded.
- **Branch-aware.** The enabled flag is a custom session entry, so `/resume` and
  `/tree` restore the right mode.

## Entering plan mode

| Path | Who starts it | Confirmation |
|---|---|---|
| `enter_plan_mode` tool | the model, before a non-trivial task | `ctx.ui.confirm` |
| `/plan` | the user | immediate |
| `/plan <prompt>` | the user, with the task | immediate |
| `Ctrl+Alt+P` | the user | immediate |
| `--plan` | the user, at launch | immediate |

The footer shows `⏸ plan` while plan mode is on.

### `/plan <prompt>`

`/plan` with no argument toggles plan mode. With an argument it enters plan
mode and sends the rest of the line as the task, so the first turn already runs
read-only:

```
/plan add rate limiting to the public API
```

## Reviewing a plan

The plan stays in the conversation, so you can scroll it; `exit_plan_mode` then
opens a menu below the editor:

```
 ⏺ ## Plan
   1. Read the parser and tokenizer.
   2. Add a Token type and the lexer.
   3. Wire the parser to the new lexer.
   4. Update and add tests.
   5. Run the suite and fix failures.
   6. Update the README.
   ⚙ exit_plan_mode  submitted a plan

 ─────────────────────────────────────────────────────────────
  Plan mode — what next?

  → Approve and execute
    Keep planning
    Refine the plan          ← opens the editor; your text goes back to the model

  ↑↓ navigate  enter select  esc cancel
 ─────────────────────────────────────────────────────────────
```

- **Approve and execute** — plan mode ends, write access returns, and the steps
  are seeded into `todo`.
- **Keep planning** — stay read-only; the model is told the plan was not approved.
- **Refine the plan** — type the change you want; it is sent back to the model,
  which revises the plan and calls `exit_plan_mode` again.

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
| `types.ts` | `PlanModeEntry`, `EnterPlanModeDetails`, `ExitPlanModeDetails`. |
| `policy.ts` | Plan mode's read-only policy and shared prompt summary. |
| `steps.ts` | `extractPlanSteps` (pure). |
| `runtime.ts` | Enabled state, tool gating, persistence, footer status. |
| `tools.ts` | `enter_plan_mode` and `exit_plan_mode`. |
| `commands.ts` | `/plan`. |
| `../_shared/policy.ts` | Shared read-only capability policy (default-deny + `readOnlyHint`). |
| `../_shared/path-guard.ts` | Path-argument detection for the read-only backstop. |
