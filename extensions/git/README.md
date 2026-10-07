# git — read-only git inspection for Pi

A single `git` tool that answers the git questions that come up while exploring a
codebase, without a shell. It builds its argv from a closed set of actions and
runs git through `pi.exec`, so it cannot be steered into a mutating subcommand
or an option-injection payload.

```
pi --extension ./extensions/git
pi -e .                                     # load the whole package
```

## Actions

| `action` | Runs | Useful options |
|---|---|---|
| `status` | `git status --short --branch` | `path` |
| `diff` | `git diff --no-color` | `staged` (`--cached`), `stat`, `ref`, `path` |
| `log` | `git log --oneline --no-color -n<limit>` | `limit` (default 20, max 200), `stat`, `ref`, `path` |
| `show` | `git show --no-color <ref>` | `ref` (default `HEAD`), `stat`, `path` |
| `branch` | `git branch --all --no-color` | — |

Revisions are validated (`ref` may not lead with `-`), and a `path` is passed
after `--`, so neither can be read as a git option. The tool is annotated
`readOnlyHint: true`, which is what lets plan mode keep git visibility even
though raw shell is disabled while planning.

## What it does not do

There is no `commit`, `add`, `push`, `checkout`, `stash`, or arbitrary git
command. Use the normal tools (or a shell outside plan mode) for those.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Tool registration, execution, and rendering. |
| `schema.ts` | TypeBox params, revision validation, and argv building (pure). |
| `format.ts` | Result formatting and truncation (pure). |
