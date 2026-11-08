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

The call returns at once with a run id, and the child keeps going. `/agents`
lists it:

| Key | What it does |
|---|---|
| `Enter` | open the run: its task, its directory, and what it has said |
| `c` | collect a finished result into the conversation |
| `x` | cancel a running one, killing its process group |

The list is newest first, from this session's branch, so a run that never
finished reads `interrupted` — a restart cannot resume it. Up to four background
children run at once; what one hands back is capped at 50 KiB of text.

## Ask for a narrower child

When the answer is all you want, say so in the sentence — the parameters are
called by name when you do:

```text
Have a read-only agent check whether any caller of the retry helper passes a
negative count, and do not let it write anything.
```

That is `readOnly: true`: the reader toolset, whatever the agent file says. Plan
mode turns it on for you, and while a plan is unapproved a background run is
refused too. `agentScope` is the other one you may want: `user` for your own
agent files, `project` for the repository's `.pi/agents`, or both — and an
untrusted project's agents are offered, not assumed, so the dialog names them
before any runs. `cwd` roots one task or step elsewhere: the worktree a `worker`
should write in.

An agent name that resolves to nothing is refused with the roster it did find.

## Where to go next

- [`subagent`](../extensions/subagent.md) — the four built-ins, every parameter,
  the caps, and both settings.
- [`plan`](../extensions/plan.md) — read-only delegation while you plan.
- [`worktree`](../extensions/worktree.md) — the checkout a worker's writes land
  in.
