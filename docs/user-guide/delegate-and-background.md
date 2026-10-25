# Delegate and background

Some work is too long for one turn, and some belongs in its own process. A
background job runs a command beside the conversation, a watcher raises a turn
when its output matches, a specialist helper takes a task in a child process, and
the session bus lets an independent session on the same repository join in.

**Use this chapter when** a build or test run takes minutes, when you are waiting
for a condition rather than a result, or when a task can be split between
sessions.

## Background jobs and watchers

### What it is

Two ways to keep working while something slow runs.

A **job** is a command the assistant starts in the background — a build, a test
suite, a server. It keeps running while you continue the conversation, and you
can read its output, send it input, wait for it, or stop it.

A **watcher** tails a file or a command's output and looks for lines that match a
pattern. When one matches, you are told, or the assistant is woken to act on it.

### When to use them

Use a job for anything that takes longer than a normal tool call. Use a watcher
when you need to know about an event rather than poll for it: a build log, a dev
server, a test run in another window.

### Walkthrough: a job

1. Ask for the slow thing in words:

   ```text
   run the full test suite in the background and tell me when it finishes
   ```

   A `▸ 1` chip appears in the footer while it runs.

2. Type `/jobs` to open the job list:

   ```text
   /jobs
   ```

   The list includes jobs this session started and any still running in another
   open Pi window, marked `peer`.

   | Key | What it does |
   |---|---|
   | `↑` / `↓`, `j` / `k` | Choose a job |
   | `PgUp` / `PgDn`, `Home` / `End` | Move a page, or to the ends |
   | `Enter` or `l` | Open the job's log |
   | `d` or `K` | Stop the running job, after a yes/no confirmation |
   | `x` | Clear finished jobs from the list |
   | `Esc` or `q` | Close the screen |

   Inside the log, `↑` / `↓`, `PgUp` / `PgDn`, `Home` / `End`, and `g` / `G`
   scroll. The view follows the newest line until you scroll up; the header says
   `following` or `paused`. `Esc`, `Backspace`, or `q` returns to the list.

   <img src="../../assets/screens/job.png" alt="The /jobs screen: a counts summary, job rows with status glyphs and elapsed times, and the focused job's last output line" width="100%">

   */jobs: running jobs first, and the focused job's last output line.*

3. A job whose result has not been reported back to the assistant turns the chip into
   `✗ 1`; the completion notice is what clears it, not reading the log. A failed job
   keeps its result until then.

### Walkthrough: a watcher

1. Ask for the trigger:

   ```text
   watch the dev server log and tell me when a request fails
   ```

   A `⊚ 1` chip appears while the watcher is live, and `! 1` appears when it has
   matches you have not read.

2. Type `/watch` to open the watcher list:

   ```text
   /watch
   ```

   `j` / `k` choose a watcher, `Enter` or `l` opens its matches, `x` or `K` stops a
   running watcher, `d` clears stopped ones, and `Esc` closes. Both destructive
   keys ask for confirmation. `g` / `G` and `PgUp` / `PgDn` scroll the matches
   pane.

   <img src="../../assets/screens/watch.png" alt="The /watch screen: a summary line, a running file watcher and a finished command watcher, the focused watcher's path and pattern, and the key hints" width="100%">

   */watch: the watcher's source, pattern, and recent matches.*

3. The same actions are available as commands, which also work in text-only
   modes:

   | Command | What it does |
   |---|---|
   | `/watch list` | List the watchers |
   | `/watch matches <id>` | Print one watcher's matching lines |
   | `/watch logs <id>` | Print the raw output tail |
   | `/watch stop <id>` | Stop one watcher |
   | `/watch clear [all]` | Remove stopped watchers, or every watcher with `all` |

### Good to know

- A job keeps its output in a log file that rotates at 8 MiB by default, so a
  chatty command cannot fill your disk. The tail shown in the transcript is
  sanitized, so stray terminal codes cannot garble the screen.
- A watcher keeps the most recent 200 matches and lives only for the session. A
  match while the assistant is busy is raised once that turn settles; a match while it
  is idle raises a turn of its own only with `wake: true` on the watcher, and otherwise
  waits for your next turn.
- Both can wake the assistant: say "and wake me when it's done" or "wake me when
  it matches". `/bytefly settings` has **Wake when a job finishes**; the watcher's
  default is the `watch.wakeOnMatch` key in `bytefly.json`, which the settings screen
  has no row for.
- A job can outlive the session: pass `detached: true` to a `job` `start`, or set
  `job.detachedByDefault` in `bytefly.json` — neither is a settings screen row. This is
  POSIX-only; Windows refuses a detached job.
- Another session's job can be read but not killed from this one. The list says
  which session owns it.

## Delegating to specialist helpers

### What it is

`subagent` hands a self-contained task to another Pi process with a narrower job:
an **explorer** to map a codebase, a **reviewer** for a second opinion, a
**tester** to write and run tests. The helper works in its own context, so its
reading does not fill your conversation, and returns only its conclusions.

### When to use it

- A question requires reading many files, and you want the conclusion rather than
  the transcript.
- Two independent investigations can run at once.
- A change deserves a reviewer that did not write it.
- A job is long enough that you want to keep talking while it runs.

Delegation is not free: a helper starts a new Pi process and uses the same model
and provider, so it spends tokens. Use it for work that benefits from isolation.

### The built-in helpers

| Helper | Best for |
|---|---|
| `explorer` | Mapping where things are and how they fit together |
| `planner` | Drafting a plan away from the main conversation; writes nothing |
| `reviewer` | A second opinion on bugs, security, and maintainability |
| `worker` | Carrying out a defined piece of work and reporting what changed |
| `researcher` | Investigating an external question with sources and confidence |
| `tester` | Adding or updating tests and running them |
| `debugger` | Finding the root cause of a failure from evidence |
| `documenter` | Bringing READMEs, docs, and changelogs in line with the code |

Each helper has an explicit tool allowlist. A reviewer's is read-only apart from a
`bash` it is told to keep to inspection (`git diff`, `git log`, `git show`), a planner
writes nothing, and a worker cannot start more helpers.

### Walkthrough: one helper

1. Ask for the legwork:

   ```text
   use the explorer agent to find where the login flow is implemented
   ```

2. The helper runs in its own process. Its summary appears in the transcript;
   when a run keeps a transcript, it is saved under `.pi/subagents`.

3. For a helper that must not change anything, add "read-only". It receives only
   reading tools. Plan mode forces the same restriction automatically.

### Walkthrough: several helpers

- **Parallel** for independent work: "review the API module and the UI module in
  parallel". Up to eight tasks are queued, and four run at once.
- **Chain** when each step needs the previous answer: "first explore, then have
  the planner propose options". The assistant passes each result into the next
  step, and the chain stops at the first failure.

### Walkthrough: background helpers

1. Ask for a helper in the background:

   ```text
   start an explorer on the auth module in the background
   ```

   Pi replies with a run id such as `a2` and returns to the prompt. A `↳ 1` chip
   appears in the footer while it runs, and a finish notice points at `/agents`.

2. Type `/agents` to open the board:

   ```text
   /agents
   ```

   | Key | What it does |
   |---|---|
   | `j` / `k` | Choose a run |
   | `Enter` | Open its detail |
   | `c` | Collect a finished result into the conversation |
   | `x` | Cancel a running run |
   | `Esc` | Go back or close |

   The detail pane follows the latest output while the run is live, keeping only
   a bounded preview. A finished run is collected later from the same board.

   <img src="../../assets/screens/agents.png" alt="The /agents screen: running and finished background helpers with status, task, elapsed time, and usage" width="100%">

   */agents: background helpers, newest first; `c` collects, `x` cancels.*

3. A run still going when Pi exits is shown as interrupted next time. Its start
   and finish are recorded on the session branch, so `/resume` shows what
   happened.

### Bring your own helper

The built-ins are not the limit. Add a Markdown file to `<agent-dir>/agents` — usually
`~/.pi/agent/agents` — for every project, or to a project's `.pi/agents` for one
repository. The file is YAML frontmatter plus a system prompt:

```markdown
---
name: auditor
description: Reviews changes for privacy issues
tools: read, grep, find, ls
---
You are a privacy auditor. Report findings as file:line references.
```

`name` and `description` are required; `tools` accepts a comma-separated list;
`model` is optional and inherits the session's model by default. A project agent
is used only when Pi trusts the project. Project-local agents load when the
assistant asks for the `project` or `both` scope.

### Good to know

- The `subagent` tool takes exactly one mode per call: one agent, a parallel
  `tasks` list, or a `chain`. It cannot combine them.
- A run has a ten-minute deadline by default, so a stuck helper reports back
  instead of hanging the session.
- Parallel and chain calls wait for their results. Only a single run can start in
  the background.
- Each parallel task's model-facing output is capped, with the full text kept in
  the tool details.
- The helper inherits the session model and thinking level unless its agent file
  names a model. It does not inherit `-e` flags from your Pi invocation, so an
  extension tool such as `web_search` must come from an installed package.

## Coordinating parallel sessions

The `session-bus` extension lets independent Pi sessions on the same machine and
repository act as a team without sharing a conversation.

- `/sessions` opens the board. `Tab` cycles **Sessions**, **Inbox**, and
  **Claims**: sessions with their unread counts, this session's unread mail, and
  every path a session holds. `Enter` opens the focused row, `w` starts or stops
  listening — joining this session if it is not on the bus yet — and in Claims `x`
  releases a claim you hold after a y/N confirmation. It takes no argument, so a
  non-TUI session prints the same listing.
- `/team join billing-core` gives **this** session a stable target, so every
  session is named from inside it, by you — one session cannot name another. Labels
  are unique among active sessions; name the outcome a session owns, not a layer.
  It also sets Pi's session name, so the footer shows `[billing-core]` and
  `/resume` lists it; the label comes back after a resume because it is derived
  from that name.
- `session` with `action: "send"` posts a short message or event; `action:
  "inbox"` consumes messages at the start of the next turn. Delivery is pull-based
  by default, so nothing interrupts a running turn and no turn starts by itself.
- Joining is also listening: new mail is reported at this session's next turn, and
  `session({action:"join", wake:true})` raises that turn as soon as the session is
  idle, including right after a running turn settles. It is per session and
  session-only, so arming it in the owner you are waiting on is how a lead gets an
  answer without asking you to switch.
- `claim` paths before editing. A claim on `src/api` conflicts with `src/api` or
  any file below it; `release` gives it back. A crash releases it when the
  session expires.

<img src="../../assets/screens/session.png" alt="The /sessions screen: a counts summary, session rows with unread and claim counts, the focused session's cwd, claims, and identity, and the Tab scope and watch hints" width="100%">

*/sessions: the sessions on this repository, their unread counts and claims, and the focused session's identity.*

## Sharing a board

`session-bus` carries messages; `board` carries the work. A repository has **one
board**, filed under `<agent-dir>/board/<repo-key>/` rather than in the checkout, so
every session and every worktree sees the same cards.

- A card is one **feature**, not one step: the steps of the work live in the
  owner's plan and in `todo`. A card carries the feature's outcome, the session
  holding it, path hints, the plan file it is executing, and its notes.
- `board` `action: "list"` reads the board — `query` finds a card by title, path
  hint, or holder — `add` creates a `todo` card with a `priority`, `claim` takes one
  for this session, `move` changes lane, `note` appends to its history, `plan`
  records the plan file, `edit` fixes a card's title, hints, priority, or what it
  waits for, `release` gives it back, `reclaim` takes it from whoever holds it, and
  `drop` deletes a `todo`, a `done`, or one you hold. `round: true` adds the lead's
  rollup: who holds what, what is unassigned, unplanned, blocked, or has gone quiet.
- A card can wait on another (`edit` with `dependsOn`): the claim and the move to
  `doing` or `done` are refused while that card is unfinished, so the order of a
  feature's work is on the board instead of in somebody's head.
- A repository has **one page**, and the lead serves it: `/board` starts it as the seat
  `team-lead` — one name and one id for the page's whole life, so a card a browser
  claimed is still the seat's after the session that served it ends — and opens it in
  your browser: a **Board** tab with the four lanes, and a **Team** tab with one panel
  per owner. The toolbar and footer stay put while the board scrolls, and the page
  follows the store live — a card another session moves appears within a second, and an
  open card dialog updates in place. Each lane is a tray you can fold, the new-card
  dialog sits behind **+ New card** so the board opens on the work, and a filter (`/`)
  plus `?` for the keys make a wide board navigable without the mouse.
- A teammate runs `/board` too, and gets **the same page, read-only**: the note the lead
  left beside the cards names the port, the seat, and a credential that may only read,
  so there is no second page and no button that would be refused. Claiming, moving,
  editing, and writing a card stay with the session doing the work — `board`'s actions
  are the workflow, and the page is how the lead watches it.
- Joining is two separate things, and `/board status` says which one you are missing:
  any `board` action makes your work yours, and any `session` action puts you on the bus
  — where the lead's Team tab sees you — while joining is also listening, so a handoff
  is reported at your next turn and `wake: true` is what raises a turn when it lands.
- `/team` prints the round in the terminal: the rollup a `board` `list` with `round:
  true` returns, then who is live and who has gone quiet. A lead does not need a browser
  to see what needs a decision, and `/board status` prints one line about the page itself.
- Ownership is advisory. Two sessions can still edit the same file; a path claim
  in `session-bus` is what protects it.

The board records who wrote a revision and refuses a write it can no longer
justify — a card someone else claimed, or one finished a moment ago — instead of
overwriting it. Nothing prunes a finished card: `drop` is the only deletion.

## Running a round

`team` is the lead's half of the board. `assign` and `offer` are the two actions that
reach the session bus; `reclaim` writes the card alone.

- `team` `action: "assign"` hands a card to a session that is **already running**.
  The peer gets a handoff in its inbox — the card, its paths, its plan, and a line
  from you — and then the card becomes `doing`, owned by that peer. Nothing is
  started: a peer that is not listening reads the message at its next turn, and
  `session status` lists the labels a handoff can go to.
- What the peer wakes to is an instruction, not a notification: the notice names it as
  a handoff, keeps enough of the body to act on, and says the work is theirs — so the
  turn that rises starts the card rather than reporting that mail arrived.
- The order is deliberate. If the send fails, the card is untouched, and the answer
  says so; if the card changed between the send and the assignment, the answer says
  the peer should `board claim` it.
- `team` `action: "offer"` names nobody. It broadcasts an unclaimed card to every other
  live session as one event and records no owner, so the first peer to `board claim` it
  takes it; two peers claiming at once are settled by the store, so one wins and the
  other is refused with the owner named. A card nobody claims stays `todo`, which is how
  it keeps showing up as unassigned.
- `team` `action: "reclaim"` takes a card back to To do when its owner has gone
  quiet. The notes stay, so the next owner reads what happened. The board's Team tab can
  record an owner for an unowned card too, but a browser cannot message a peer, so that
  assignment says in the card's history that no handoff was sent.

A round, end to end: a `board` `list` with `round: true` to see who holds what, `team`
`assign` for each unassigned card, then the same list again once the peers settle. A
blocked card is your next decision, not theirs.

## Related

- [Plan and verify](./plan-and-verify.md) — the plan a task starts from.
- [Configuration](../configuration.md#subagent--delegated-runs) — subagent timeouts, transcripts, and background limits.

---

[← Previous: Track and remember](./track-and-remember.md) · [Guide home](./README.md) · [Next: Packaged workflows →](./packaged-workflows.md)
