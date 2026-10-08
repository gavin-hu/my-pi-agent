# `git` — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

Give the model the git questions that come up while exploring a codebase —
working-tree status, diffs, history, one commit, the branch list — without a
shell. Raw `bash` is disabled during plan mode, so a structured, provably
read-only git surface keeps that visibility.

## Non-goals

- No mutating git (`add`, `commit`, `checkout`, `stash`, `push`). A model that
  needs those uses the normal tools or a shell outside plan mode.
- Not a general `git` passthrough. The action set is closed on purpose.
- Not a replacement for the `bash` tool outside plan mode.

## Decisions

**One tool, one closed action set.** The five read-only views stay behind a
single `git` tool with an `action` enum rather than becoming `git_status`,
`git_diff`, and friends. Splitting would add four extra tool descriptions to
every turn's prompt and a noun-first `git_*` exception to the package's
verb-first naming guard, while buying nothing: all five are read-only, so
per-action permissions are moot. The one cost of a single tool — parameters that
do not apply to every action — is handled by scoping each parameter description
to its actions and ignoring inapplicable parameters.

**Closed action set, argv built here.** `schema.ts` owns a `buildGitArgs`
function that maps `{ action, … }` to a fixed `string[]`. No caller ever passes
a command string, so the tool cannot be steered into a mutating subcommand or
into option injection (`git log --output=…`).

**Validate revisions; separate paths with `--`.** A `ref` may not lead with `-`
and must match `[A-Za-z0-9_./@^~-]+`; a `path` is always emitted after `--`.
Both rules exist so a value the model chose cannot be re-read by git as an
option. An invalid `ref` throws an `Error`, which becomes a model-readable tool
error the model can retry.

**`readOnlyHint: true`.** The MCP annotation is not decoration: plan mode's
[read-only policy](../../lib/policy.ts) allows tools that carry it and blocks
the rest, which is what keeps git usable while planning. The action set being
closed is what makes the claim true.

**Follow the worktree.** Pi has no mutable session cwd. When the worktree
extension is active it publishes the effective root as `PI_WORKTREE_ROOT`, and
this tool resolves its `cwd` through `lib/env.ts` so read-only git
inspects the isolated worktree rather than the main checkout.

**Sequential execution.** `executionMode: "sequential"` — the calls are cheap
local reads, and serializing them keeps transcript output ordered.

**Truncate at one boundary.** `format.ts` caps model-facing output at
`MAX_OUTPUT` (`formatGitResult`), and the renderer re-caps before drawing. Git
can emit megabytes (a `diff` of a large change), and the model rarely needs more
than the head of it.

**Grouped as a proper module.** The git tool lives under `tool/` (`index.ts`
registration/execution, `schema.ts` pure params/argv, `format.ts` pure output,
`render.ts` transcript rendering), so it mirrors `worktree/` and `rewind/` and
the extension root holds only the composition root and docs.

## One extension, three git surfaces

The git tool, worktree isolation, and rewind all speak git but do not overlap:
the tool reads state, worktree changes the session's root, and rewind snapshots
it. They are composed into one extension at `index.ts`
(`registerWorktree` → `registerGitTool` → `registerRewind`) so a package install
loads one entry, the modules share the `lib/` helpers, and the worktree built-in
overrides keep registering before peer extensions. The three modules remain
separated by responsibility, not by extension boundary.

`registerWorktree` receives the composition root's own path as `entryPath`:
Pi records the entry file as the source of every tool the extension registers,
and `findInactiveOverrides` compares against that to decide whether the
built-in overrides actually took effect. Deriving the path from the worktree
module's own `import.meta.url` would no longer be correct.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Composition root: registers worktree, the git tool, and rewind. |
| `tool/index.ts` | Tool registration, execution, `cwd` resolution, wiring. |
| `tool/schema.ts` | TypeBox params, revision validation, argv building (pure). |
| `tool/format.ts` | Result formatting and `MAX_OUTPUT` truncation (pure). |
| `tool/render.ts` | Transcript rendering: preview, call line, result color. |
| `worktree/` | The worktree module (see its `DESIGN.md`). |
| `rewind/` | The rewind module (see its `DESIGN.md`). |
