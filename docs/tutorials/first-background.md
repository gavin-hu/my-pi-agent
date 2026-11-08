# Run long work in the background

Two extensions keep a long command from holding the turn: `job` runs it and keeps
its log, and `watch` reads a stream and tells you when a line matters. This
walkthrough starts a test suite, gets told how it ended, then leaves a watcher on
a server's output.

You need Pi and this package installed — see [Install](../install.md).

## Start the long command

Ask for it the way you would say it:

```text
Run the full test suite in the background and tell me when it fails.
```

The model starts it as a job. The command runs with stdout and stderr streamed to
a log that rotates instead of filling the disk, and the turn comes back
immediately — so you can read, edit, and ask questions while it runs.
## Look in on it

```text
/jobs
```

Running jobs come first, then recent ones, each row carrying its id, a label for
its command, and how long it has run. The focused row adds the rest — directory,
outcome, and last line:

| Key | What it does |
|---|---|
| `↑`/`↓` or `j`/`k` | select |
| `Enter` or `l` | open the log (`g`/`G` jump, `Esc` returns) |
| `d` | kill, after a `y`/`N` prompt |
| `x` | clear this session's finished jobs, after a prompt |
| `Esc` | close the list |

Clearing is not free: a result it had not reported to the model goes with it.
A job another session started is shown tagged `peer`: its log opens, but it
cannot be killed or cleared from here.

## Be told, instead of asking

A finish is reported at the start of your next turn by default. Ask for a wake
instead — `wake: true` on the start, or `wakeOnFinish` for every job — and the
finish raises a turn as soon as the agent is idle:

```text
Run the build, and wake me the moment it exits non-zero.
```

You can also ask the model to wait, with a timeout, when the next step needs the
result before it can start. The job keeps running either way.

## Feed it a line

A job started with `stdin: true` can be driven later: `send` writes a line to it,
and `eof: true` closes its input. That is enough for a script that asks a
question or waits for `continue` — it is a pipe, not a terminal, so a full-screen
program will not work.

## Watch the line, not the job

A job tells you how something ended; a watcher tells you when something appeared.
Ask for one on a file or on a command's output:

```text
Watch the dev server's output for ERROR or Traceback.
```

A file watcher follows a log from its end, a command watcher streams the command's
merged output, and both take an exclude list and `caseSensitive: true` when the
pattern needs it. Then `/watch` lists them, one row each with its match count:

```text
/watch
```

`Enter` on a row opens its matches — the focused row is where the line count and
the pattern are — and `/watch matches <id>` prints them, while `/watch logs <id>`
shows the raw tail when a pattern matched nothing. A watcher added with a wake
raises one turn as soon as the agent is idle, carrying every match that landed;
with `notify` on, that turn also leaves a desktop notification.

## Leave it behind

A detached job survives the session on POSIX; Windows refuses the flag rather
than pretending, and a job there may settle as `unknown`. Detached or not, one
registry file per session, a marker per session, and one log per job live under
`~/.pi/agent/jobs/<project>/`, which is why a job reattached after a restart
still has its output — and its real exit code, recorded by a shell `EXIT` trap.
A detached job writes its own log, with nothing to rotate it, so it grows until
you clear it.

## Where to go next

- [`job`](../extensions/job.md) — actions, the screen, exit codes, and every
  setting.
- [`watch`](../extensions/watch.md) — patterns, bounds, and how a match reaches
  you.
- [`subagent`](../extensions/subagent.md) — handing the work to another agent
  instead of another process.
