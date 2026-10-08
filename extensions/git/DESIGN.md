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
[read-only policy](../_shared/policy.ts) allows tools that carry it and blocks
the rest, which is what keeps git usable while planning. The action set being
closed is what makes the claim true.

**Follow the worktree.** Pi has no mutable session cwd. When the worktree
extension is active it publishes the effective root as `PI_WORKTREE_ROOT`, and
this tool resolves its `cwd` through `_shared/worktree-env.ts` so read-only git
inspects the isolated worktree rather than the main checkout.

**Sequential execution.** `executionMode: "sequential"` — the calls are cheap
local reads, and serializing them keeps transcript output ordered.

**Truncate at one boundary.** `format.ts` caps model-facing output at
`MAX_OUTPUT` (`formatGitResult`), and the renderer re-caps before drawing. Git
can emit megabytes (a `diff` of a large change), and the model rarely needs more
than the head of it.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Tool registration, execution, `cwd` resolution, rendering. |
| `schema.ts` | TypeBox params, revision validation, argv building (pure). |
| `format.ts` | Result formatting and `MAX_OUTPUT` truncation (pure). |
