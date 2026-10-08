# git — read-only git, worktree isolation, and rewind for Pi

One extension that composes three related git surfaces:

| Module | What it adds |
|---|---|
| [`tool/`](./tool/) | A single read-only `git` tool (`status`, `diff`, `log`, `show`, `branch`) that builds its own argv and runs git through `pi.exec`, so it cannot be steered into a mutating subcommand. |
| [`worktree/`](./worktree/) | Isolated `git worktree` lifecycle: `enter_worktree` / `exit_worktree` / `prune_worktrees` / `list_worktrees`, `/worktree*`, and `--worktree <name>`. |
| [`rewind/`](./rewind/) | Automatic per-prompt snapshots under `refs/pi/rewind`, plus `/rewind` to restore code, conversation, or both. |

```
pi --extension ./extensions/git
pi -e .                                     # load the whole package
```

The composition root is [`index.ts`](./index.ts): it calls `registerWorktree`,
`registerGitTool`, and `registerRewind`. Worktree registers first so its
built-in tool overrides keep the precedence they had when it was its own
extension.

## The `git` tool

| `action` | Runs | Useful options |
|---|---|---|
| `status` | `git status --short --branch` | `path` |
| `diff` | `git diff --no-color` | `staged` (`--cached`), `stat`, `ref`, `path` |
| `log` | `git log --oneline --no-color -n<limit>` | `limit` (default 20, max 200), `stat`, `ref`, `path` |
| `show` | `git show --no-color <ref>` | `ref` (default `HEAD`), `stat`, `path` |
| `branch` | `git branch --all --no-color` | — |

Each action accepts only its own parameters: `status(path)`; `diff(ref,
staged, stat, path)`; `log(ref, limit, stat, path)`; `show(ref, stat, path)`;
`branch(no parameters)`. A parameter outside that set is ignored (for example
`limit` on `status`).

Revisions are validated (`ref` may not lead with `-`), and a `path` is passed
after `--`, so neither can be read as a git option. The tool is annotated
`readOnlyHint: true`, which is what lets plan mode keep git visibility even
though raw shell is disabled while planning. When the worktree module is active
it publishes `PI_WORKTREE_ROOT`, and the git tool follows it so read-only
inspection targets the isolated worktree.

### What it does not do

There is no `commit`, `add`, `push`, `checkout`, `stash`, or arbitrary git
command. Use the normal tools (or a shell outside plan mode) for those.

## Worktree and rewind

See [`worktree/README.md`](./worktree/README.md) and
[`rewind/README.md`](./rewind/README.md) for the full command/tool surface,
configuration, and guard behavior.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Composition root: registers the worktree, git, and rewind modules. |
| `tool/index.ts` | The `git` tool: params, annotations, execution, and wiring. |
| `tool/schema.ts` | TypeBox params, revision validation, and argv building (pure). |
| `tool/format.ts` | Result formatting and truncation (pure). |
| `tool/render.ts` | Transcript rendering: preview, call line, result color. |
| `worktree/` | Worktree lifecycle, guards, built-in tool overrides, config, state. |
| `rewind/` | Snapshots, timeline, restore, config, `/rewind` command and TUI. |
