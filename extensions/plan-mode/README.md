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

- **Read-only gating.** `write` and `edit` are removed from the active tool set,
  and `bash` is limited to an allowlist of read-only commands.
- **Model entry point.** The model can call `enter_plan_mode` to ask for plan
  mode before a non-trivial task; the user confirms.
- **Reviewable plan.** The model writes the plan in its reply, then calls
  `exit_plan_mode`; the user approves, keeps planning, or asks for a refinement.
- **Steps become todos.** On approval, the plan's numbered steps are recorded
  with the `todo` tool (via `ctx.executeTool`), so execution starts tracked.
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

## The bash allowlist

`analyzeCommand` splits the command line into segments (`;`, `&&`, `||`, `|`,
newlines, quote-aware) and requires every segment's first word to be on a
read-only allowlist. It also rejects argument-level escape hatches.

Allowed: `cat`, `head`, `tail`, the search tools (`grep`, `rg`, `find`, `fd`),
`ls`, `wc`, `sort`, `diff`, `jq`, `sed -n`, read-only `git` (`status`, `log`,
`diff`, `show`, `branch`, `remote`, `config --get`, `worktree list`, …), read-only
`npm`/`yarn`/`pnpm`/`bun` subcommands, interpreters with `--version`, `curl`/`wget`
GETs, and more.

Rejected: `rm`, `mv`, `chmod`, `sudo`, command substitution (`$(…)`, backticks),
`> file` redirection (except `/dev/null` and `2>&1`), `find -exec`/`-delete`,
`sed -i`, `git commit`/`push`/`add`, `npm install`, `curl -X POST`, `xargs`,
`bash -c`, and wrapper commands such as `env … <cmd>`.

> This is a guard rail, not a sandbox. Extensions run with Pi's OS permissions;
> the allowlist prevents accidental writes while planning, not a hostile command.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Wiring: tools, command, flag, shortcut, events, bash guard, context injection. |
| `types.ts` | `PlanModeEntry`, `EnterPlanModeDetails`, `ExitPlanModeDetails`. |
| `safety.ts` | `analyzeCommand` / `isSafeCommand` / `splitSegments` (pure). |
| `steps.ts` | `extractPlanSteps` (pure). |
| `runtime.ts` | Enabled state, tool gating, persistence, footer status. |
| `tools.ts` | `enter_plan_mode` and `exit_plan_mode`. |
| `commands.ts` | `/plan`. |
