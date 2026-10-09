# memory — durable cross-session notes for Pi

A small, model-writable store of short facts that Pi recalls automatically in
later sessions: preferences, environment quirks, conventions, decisions. Notes
live as human-editable markdown, not in the session branch, so they survive
`/new`, `/resume`, and `/tree`. Long-form knowledge still belongs in
`AGENTS.md`; `memory` is for the one-liners the model should not have to be
reminded of twice.

```bash
pi --extension ./extensions/memory    # load just this extension
pi -e .                               # load the whole @gavin-hu/my-pi-agent package
pi install ./                         # install the package
```

## What it does

- Registers one model-callable tool, `memory`, with three actions: `add` a note,
  `forget` an exact note, or `list` what is stored.
- Keeps two stores, both plain markdown with one bullet per note:

  | Scope | File |
  |---|---|
  | `global` | `<agent-dir>/memory.md` |
  | `project` | `<repo-root>/.pi/memory.md` |

  The project store is anchored at the **repository root**, so it is stable when
  Pi runs from a subdirectory and shared across git worktrees.
- Injects the stored notes as a hidden `[MEMORY]` context message before each
  run, bounded by a byte cap, so the model recalls them without being asked.
- Exposes `/memory` to list the store, print the file paths, open the multi-line
  editor, or clear a scope.
- Loads and writes the project store only when the project is trusted, sanitizes
  every note to one terminal-safe line, and writes atomically.

## Tool

`memory` is a singleton tool with an action switch (like `job`). It declares an
`outputSchema` and returns matching `structuredContent`
(`{ action, scope, project, global, changed, entry?, error? }`).

| Field | Value |
|---|---|
| `name` | `memory` |
| `action` | `add` \| `forget` \| `list` |
| `text` | The note to add, or the exact note to forget. Required for `add`/`forget`. |
| `scope` | `project` (default) or `global`. Used by `add`/`forget`. |
| `exposure` | `direct` (default). |
| `executionMode` | `sequential` — calls share the cached stores. |
| `annotations` | `readOnlyHint: false`, `destructiveHint: true` (forget deletes), `idempotentHint: true`, `openWorldHint: false`. |
| `outputSchema` | `MemoryResult` — also returned as `structuredContent`. |

Validation happens before anything is written (a violation returns an error
result carrying the unchanged notes, never a half-apply): a known action; a
non-blank `text` of at most 500 characters for `add`/`forget`; an exact match for
`forget`; and `project` scope only for a trusted project.

Notes are normalized to a single line: control characters (including `ESC`)
become spaces and whitespace runs collapse to one space, so a note cannot inject
terminal sequences when it is injected or rendered. Matching is exact on the
trimmed text; `add` of an existing note is a no-op, and `forget` removes every
exact match.

## Commands

| Command | What it does |
|---|---|
| `/memory` or `/memory list` | Notify the stored notes and counts. |
| `/memory path` | Notify the two file paths and whether the project store is trusted. |
| `/memory edit [project\|global]` | Open the multi-line editor prefilled with the file and save the result. |
| `/memory clear [project\|global]` | Clear a scope after a confirmation. |

Bulk deletion lives only in the command, behind a confirm — the model cannot wipe
memory in one call.

## Behaviour by mode

The tool and the context injection work in every mode (`tui`, `rpc`, `json`,
`print`). The interactive-only parts of `/memory` (`edit`, `clear`) require
`ctx.hasUI`; in JSON and print sessions the command reports that editing needs an
interactive session. Memory itself is external state, so it is not reconstructed
from the session tree and tree navigation does not change it.

## Configuration

`memory.json`, read from `~/.pi/agent/memory.json` then `<cwd>/.pi/memory.json`
(project values override global; missing or malformed files are ignored):

| Key | Default | Meaning |
|---|---|---|
| `inject` | `true` | Inject stored notes before each run. |
| `maxInjectBytes` | `8192` | Cap on the injected body, clamped to `512..32768`. |

The tool and command always work; only recall is configured.

## Security

Project memory is repository-controlled text that becomes part of the model's
context, so it is a prompt-injection surface, like `AGENTS.md` or a project
skill. Mitigations:

- The `project` store is read and written only when `ctx.isProjectTrusted()` is
  true. An untrusted project contributes nothing to the injection, and a
  `project` write is rejected with a message steering the model to `global`.
- Every note is sanitized with `stripControlChars` + `sanitize` before storage,
  injection, and rendering.
- Reads are capped at 256 KiB and the injected body at `maxInjectBytes`.
- The path is a fixed constant; a symlink at the memory path is refused.
- The files are ordinary user-owned markdown. They are **not** self-ignored like
  `.pi/plans`, so committing or sharing them is the user's choice; review
  project memory before trusting a repository.

## Limitations

- Notes are injected whole (bounded), so a very large store is truncated with a
  `(+N more; use the memory tool)` tail rather than summarized.
- External edits made while a session is open are not picked up until the next
  session start; use `/memory edit` or the tool to stay in sync.
- Matching for `forget` is exact and case-sensitive.
- Only one note per line; multi-line notes are collapsed to a single line.

## Non-goals

- No semantic search, embeddings, or a vector store.
- No multi-line or rich notes; long-form knowledge belongs in `AGENTS.md`.
- No per-note ids, priorities, tags, or timestamps.
- No automatic extraction of facts from the transcript.
- No persistent widget; unlike `goal`/`todo`, memory adds no rail.
- No bulk clear through the tool (command-only, confirmed).

## Pi integration

| Contract | Detail |
|---|---|
| Registration | The default export registers the `memory` tool, the `/memory` command, and four event listeners; nothing long-lived. |
| Events | `session_start` loads config and both stores; `before_agent_start` injects the `[MEMORY]` message; `context` keeps only the newest injection; `session_shutdown` clears the cache. |
| Tool | `exposure: "direct"`, `executionMode: "sequential"`, `annotations` and `outputSchema` as above. |
| State | External markdown, **not** branch state: the tool result's `details`/`structuredContent` mirror the call but the notes are read from disk and survive independently of `/resume` and `/tree`. |
| UI | `ctx.ui.notify`, `editor`, and `confirm`, guarded by `ctx.hasUI`; no custom component. |
| Plan mode | Blocked — `plan`'s read-only policy allows only `readOnlyHint` tools, so memory cannot be mutated while planning; recall still works. |

## Design notes

- **External storage, deliberately.** `goal`/`todo` keep state in tool-result
  `details` because it follows the active branch. Memory is the opposite: it must
  outlive the branch and be editable outside Pi, so it is plain files read at
  session start (`lib/README.md`'s "data outside one session — external
  storage").
- **A message, not the system prompt.** The injection follows the established
  `goal`/`plan`/`job` pattern: a hidden custom message, deduplicated by a
  `context` handler, re-added each run so edits are reflected without a reload.
- **Repo-root anchor.** Resolving the project store with `lib/git`'s
  `repoRootFor` matches `plan/plans.ts` and keeps worktrees from stranding notes.
- **Read-modify-write under a queue.** Host `withFileMutationQueue` serializes
  writers for the same file, and each write lands atomically via a temp file and
  rename; `executionMode: "sequential"` keeps in-process calls ordered as well.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: guard, register tool/command, session wiring and injection. |
| `types.ts` | `MemoryScope`, `MemoryAction`, `MemoryDetails`, the context type. |
| `config.ts` | Defaults and `memory.json` loading/clamping. |
| `schema.ts` | TypeBox params/result and pure validation of action, scope, and text. |
| `store.ts` | Paths, parse/read, add/forget/clear transforms, atomic queued write. |
| `runtime.ts` | Session cache of both stores; trust gating; mutations. |
| `format.ts` | Pure call/result/notice text and the bounded injection body. |
| `tools.ts` | `registerTool("memory", …)`. |
| `commands.ts` | `registerCommand("memory", …)`. |

## Testing

`bun test extensions/memory` covers the pure store transforms, schema and config
validation, formatting/injection truncation, and the extension surface
(registration, `session_start` loading, injection and dedup, trust gating, and
the `/memory` command) through the `test/helpers/fixtures/memory.ts` suite
harness.
