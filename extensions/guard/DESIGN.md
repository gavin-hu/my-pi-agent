# `guard` — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

Close the package's one outright safety gap: nothing stopped a destructive tool
call or a write to a sensitive file outside plan mode. `guard` adds a
permission gate that is always on, fail-safe without a UI, cheap to run, and
independent of rendering.

## Decisions

**One `tool_call` handler, three checks, one pure verdict.** Path protection,
command danger, and destructive annotations are separate concerns but a single
event. `assessToolCall` returns `allow | confirm | block` with a reason and a
stable `detail` identity; `index.ts` only turns that into `ctx.ui` calls and a
`{ block: true }` result. This keeps the policy unit-testable and the wiring
thin, mirroring `plan-mode/safety.ts`.

**Entry-path tools share an implementation with plan mode.** Plan mode already
ships a command splitter and a read-only allowlist. Guard needs the opposite
(deny/confirm over ordinary commands), so it reuses the splitter's shape but not
the allowlist: a flagged command is not necessarily disallowed, only gated. The
glob matcher is likewise a local copy of the gitignore-style one in
`worktree/include.ts`, kept independent to avoid a cross-extension import.

**Block beats confirm, and `allow` beats both.** A command can match several
patterns; the analyzer resolves `block` first, then `confirm`. A user `allow`
regex is checked before anything else so it can carve out an exception without
disabling built-ins.

**Fail safe without a UI.** In print/JSON (and any no-UI RPC path), a confirm
verdict becomes a block unless the user explicitly sets
`nonInteractive: "allow"`. This matches the Pi examples' philosophy: the safe
default must not depend on a prompt appearing.

**Block short-circuits; guard is listed last.** The runtime's `emitToolCall`
returns on the first `{ block: true }`, and handlers run in load order. Listing
guard last means `worktree`'s escape guard and `plan-mode`'s read-only block run
first. Guard therefore never re-prompts a call another extension already
refused, and plan mode's hard block stays prompt-free. Plan mode also removes
`write`/`edit` from the active set, so those calls never reach guard at all.

**Protected paths resolve against the live `ctx.cwd`.** Under an active
worktree the root-tools proxy reports the worktree as `cwd`, so guard matches
patterns there rather than in the main checkout. The config cache is keyed by
`cwd`, so a worktree switch reloads it.

**Per-session confirmation memory, in memory only.** A repeated `rm -rf dist`
build step should prompt once, not every turn. Approved `kind:detail` keys live
in a `Set`, cleared on `session_start`/`session_tree`/`session_shutdown`. It is
deliberately not persisted as a session entry: it is a convenience, not branch
history, and must not resurrect after `/resume`.

**Annotations: narrow by default, broad opt-in.** `destructiveHint === true`
confirms. The MCP "missing hints imply destructive/open-world" heuristic is
available but off, because it would confirm every unannotated MCP tool; when
enabled it skips the built-ins and this package's own tools.

## Non-goals

- An OS sandbox. Command substitution, `eval`, and `sh -c` are not analyzed;
  real isolation needs OS-level machinery.
- Guarding `user_bash` (a `!` command the user types). Guard is a model-tool
  gate.
- Persistent cross-session approvals.
- Project-config discovery by walking up from a worktree root to the main
  checkout.

## Test surface

`test/guard/` covers `globToRegExp`/`matchProtectedPath`/`toMatchPath` and the
default protected set; `analyzeCommand` across safe/block/confirm cases, config
overrides, and `includeBuiltins`; `assessToolCall` precedence and annotations;
and the extension itself (register, block, confirm yes/no, no-UI policy, extra
patterns, per-session memory, `/guard` toggle and status).
