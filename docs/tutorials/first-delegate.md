# Hand a task to another agent

`subagent` gives one task to a specialist agent running in its own Pi process.
The child reads files and runs commands in a context of its own, so a broad search
does not fill your conversation — only its final reply comes back. This
walkthrough takes one agent, then a batch, then a long hand-off you collect later.

You need Pi and this package installed — see [Install](../install.md).

## Ask for one

Say what you want found, not which tool to use:

```text
Find where the HTTP client retries, and show me the lines.
```

The model calls an `explorer`, which has the readers and nothing else:

```text
subagent({ agent: "explorer", task: "Find where HTTP is retried" })
```

What comes back is the summary and the call's usage, folded in the transcript.
What you should see is the answer — file and line, or the reason it is not there —
not a second copy of the search.

## Ask for three at once

A question with independent halves is one call:

```text
In parallel: have one agent trace where sessions are persisted, one check which
settings are read at startup, and one review the retry diff.
```

Each task is its own child with its own allowlist, so one cannot reach back into
`subagent`. A batch takes up to eight tasks and runs four at a time; a task that
fails is reported as that task, and the others still finish.

## Do steps in order

When the second move needs the first one's answer, ask for a chain:

```text
Chain it: first find the config loader, then have the next agent list every key
it accepts.
```

Each step receives the previous step's output as `{previous}`, up to 24 KiB of
it. A chain takes eight steps and stops at the first failure rather than running
the rest on an answer that never arrived.

## Hand off a long one

For work that outlasts the turn, ask for it in the background:

```text
Have a worker write the tests in the background while I keep reading this diff.
```

The call returns at once with a run id, and the child keeps going. Type `/agents`
to see it:

| Key | What it does |
|---|---|
| `Enter` | open the run: its task, its directory, and what it has said |
| `c` | collect a finished result into the conversation |
| `x` | cancel a running one, killing its process group |

`/agents` lists running runs first, then finished ones — also the runs whose
session is gone. Up to four background children run at once; a finished run's
collected output is capped at 50 KiB.

## Keep the child on a leash

Three parameters do most of the work, and you can ask for them by name:

- `readOnly: true` forces the reader toolset, whatever the agent file says.
  Plan mode does this for you — while a plan is unapproved, every call is
  read-only and a background run is refused.
- `agentScope` decides where agent files come from: your own (`user`), the
  project's `.pi/agents` (`project`), or both. A project directory loads only
  when the project is trusted, so a repository cannot inject a prompt by adding
  a file.
- `cwd` roots one task or one step somewhere else — the worktree a `worker`
  should write in, for instance.

An agent name that resolves to nothing is refused with the roster it did find.

## Where to go next

- [`subagent`](../extensions/subagent.md) — the four built-ins, every parameter,
  the caps, and both settings.
- [`plan`](../extensions/plan.md) — read-only delegation while you plan.
- [`worktree`](../extensions/worktree.md) — the checkout a worker's writes land
  in.
