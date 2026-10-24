# plan — file-backed planning for Pi

A read-only exploration mode modelled on Claude Code's `EnterPlanMode` /
`ExitPlanMode` pair. While plan mode is on, the model investigates and proposes,
but the only thing it may write is the plan file itself. The plan is saved under
the agent directory; the user reviews that file, and it is the artifact the model
executes.

## Capabilities

Status records what a reader can rely on: **Shipped** is in a tagged release, **Unreleased** is complete in the current tree but not yet tagged, and **Partial** has one released part and one unreleased part. Rows are ordered by user value, highest first.

### Planning lifecycle

| Capability | How | What you get | Status |
|---|---|---|---|
| Read-only planning | `enter_plan_mode`, `/plan`, `Ctrl+Alt+P`, `--plan` | The session keeps only its readers, so the model investigates and proposes without touching the tree. | Shipped |
| Confirmed model entry | `enter_plan_mode` | The model asks before it takes write access away, and the user answers first. | Shipped |
| Read-only git shell | `bash` with the read-only git allowlist | Plan mode can inspect `git status`, `diff`, `log`, and `show`; pipes, redirects, and non-git commands are refused. | Shipped |
| Read-only delegation | `subagent` with forced `readOnly: true` | A delegated agent can read and search but cannot write, edit, or run a shell while the plan is being researched. | Shipped |
| Absolute-path guard | `path-guard.ts` | A path outside the project is refused unless it is a known plan-safe reader, so planning cannot write through an absolute path. | Shipped |
| One writable artifact | `write_plan` | The plan lands as markdown under the agent directory, one store per repository, shared by its worktrees. | Shipped |
| Approval gate | `exit_plan_mode` | The plan is read back and presented; nothing is written until the user approves it. | Shipped |
| Session goal at approval | `goal` at approval | A `planning` goal is promoted to the plan's objective, and a session with none gets it, without a second dialog; an active goal is left alone. | Shipped |
| Steps as todos | `exit_plan_mode` | Approval seeds the plan's steps into the todo list, with the verification section as the last item. | Shipped |
| Plan kept current | `set_plan_steps` | Ticking a step rewrites its checkbox in the file and its todo item in one call. | Shipped |
| Stale-step protection | `expected` in `set_plan_steps` | A step whose number moved, is out of range, or no longer matches its text refuses the whole batch instead of ticking the wrong line. | Shipped |
| Cancel without a plan | `cancel_plan_mode`, `/plan cancel` | Write access returns, and no todo items or goal are recorded. | Shipped |
| Plans index | `/plan list` | Every saved plan with its title, modified time, and step progress, newest first. | Shipped |
| Plan-store migration | `<repo>/.pi/plans` to the agent-dir store | A store left by an older version is moved in once, with a notice, so worktrees and main see the same index. | Shipped |
| Instruction-file bootstrap | `/skill:init` | The packaged `init` skill plans and gates a project's `AGENTS.md`, writing only after approval. | Shipped |
| Parallel slices | `exit_plan_mode` `units`, `plan.split` | An approval can name the units a team of sessions joins, with a roster card for the lead. | Shipped |
| Split validation gate | `checkSplit` | Overlapping paths, dependency cycles, more than two owners, no test, a shared file, or no lead is refused before a review opens — and the same shared list refuses an owner's `claim` once the team is running. | Shipped |
| Branch-following mode | the `plan-mode` session entry | `/resume` and `/tree` restore the mode and its tool set for the branch they land on. | Shipped |

### Review

| Capability | How | What you get | Status |
|---|---|---|---|
| Review screen | `exit_plan_mode` | A scrollable, themed plan with approve, refine, keep, browser, and exit in the footer. | Shipped |
| Browser page | `/plan review`, `w` on the review screen | The plan opens in a local browser as a reading-first page with live section and step progress. | Shipped |
| Approval in the browser | the `/plan review` page's **Approve & run** | The plan is approved without returning to the terminal, and the steps are seeded. | Shipped |
| Inline comments | the page's `+ Comment`, **Save feedback** | Comments are saved into the plan file as `> [!REVIEW]` lines and returned to the model. | Shipped |
| Live page | the page's `events` stream, the plan-file poll | An edit made elsewhere repaints every open page without a reload. | Shipped |
| Changed sections | the `exit_plan_mode` review screen, the `/plan review` outline | After a refinement, only the sections that changed are marked. | Shipped |
| Section navigation | the review screen, `n`/`p` | The screen names the section you are in and jumps between headings. | Shipped |
| Remote review | `exit_plan_mode` on a WeChat turn | The plan file is sent, then one compact prompt to approve, keep planning, or exit. | Shipped |

### Collaboration

| Capability | How | What you get | Status |
|---|---|---|---|
| Shared review | `/plan share`, **Share** | A reviewer link, with a QR a phone can scan, opens the same plan from another machine on this Wi-Fi. | Shipped |
| One link per teammate | **New link**, **Revoke**, `/plan share stop` | Each teammate holds a link of their own, and one is revoked without disturbing the rest. | Shipped |
| Two roles | the owner's `token`, a reviewer's link | Only the owner saves, approves, cancels, and manages links; a reviewer reads and comments. | Shipped |
| Signed comments | the page's `name` control | A reviewer's name binds to her link on its first post, so her notes are hers and the file records who wrote them. | Shipped |

## Quickstart

```bash
pi --extension ./extensions/plan   # load just this extension
pi -e .                            # load the whole @gavin-hu/my-pi-agent package
pi install ./                      # install the package for a user
```

```text
/plan                                       # toggle plan mode
/plan add rate limiting to the public API   # enter plan mode and send the task
```

The model calls `enter_plan_mode` before a non-trivial task; `/plan` and
`Ctrl+Alt+P` are the user's own switch.

## Tools

How the `write_plan` and `exit_plan_mode` calls and their results look in the transcript — the call line as a headline and the body indented under it:

<img src="../../assets/tools/write_plan.png" alt="The write_plan tool's call and result: the call line and an indented body with the saved plan path and byte count" width="100%">

<img src="../../assets/tools/exit_plan_mode.png" alt="The exit_plan_mode tool's call and result: the call line and an indented body with the approval line and the approved plan preview" width="100%">

All five tools are `executionMode: "sequential"` and closed-world. Two are active
in normal mode and three are `defaultActive: false`, so the plan-mode tool set
stays small.

| Tool | Active | Purpose |
|---|---|---|
| `enter_plan_mode` | normal mode | Ask to enter plan mode; empty schema, confirmed with `ctx.ui.confirm`. |
| `write_plan` | plan mode | Save the plan: `title` (file-name slug), `content` (full markdown in the documented outline), optional `plan_path` to overwrite a refinement. Returns the absolute path. |
| `exit_plan_mode` | plan mode | Read the plan file (`plan_path`) and present it for approval. Optional `units` proposes a split when `plan.split` is on. |
| `cancel_plan_mode` | plan mode | Leave plan mode without a plan file or a review. Empty schema. |
| `set_plan_steps` | normal mode | Set the checkboxes of the given top-level steps of an approved plan in one write, and their todo items with them. |

### `enter_plan_mode`

No parameters. It confirms with `ctx.ui.confirm` before switching the tool set,
because the model is changing the mode on the user's behalf; a declined confirm
answers "stayed in normal mode" and the session keeps write access. Already
planning, it says so. With no UI it fails with an actionable message instead of
deciding for the user.

On a remote turn the confirmation is a short consent sentence in the peer's
language, and the notice names how to leave.

### `write_plan`

`title` is the file-name slug, `content` the full markdown, and `plan_path`
overwrites an existing plan when refining. The result carries the absolute path,
the relative path, and the byte count — the absolute path is what `exit_plan_mode`
takes.

The file lands in
`<agent-dir>/plans/<repo-key>/<YYYY-MM-DD-HHmm>-<slug>.md`, keyed by the
repository's common git directory, so a plan approved in one worktree is the
same plan from the main checkout and from every other session. Outside a
repository the store is `<agent-dir>/plans`. Plans are outside the project, so
they are never untracked files and never appear in a `rewind` snapshot; a store
an older version left in `<repo>/.pi/plans` is moved in once, with a notice.

The description documents a canonical outline — a `# <Title>`, then `## Goal`,
`## Context`, `## Approach`, `## Visual`, `## Steps`, `## Risks`, and
`## Verification` — and the model is guided to follow it. Every example in the
template is the shape wanted rather than a description of it, and each section
has one job: the goal is one sentence, the context is the facts that force the
approach, the approach names the alternative it rejected, and verification is a
fence of the commands to run. `Visual` carries the end state in an untagged
fence, with one line naming what to look at: the same surface before and after
when the change alters one that already exists, one frame when the surface is
new, because a reviewer judges the result before the steps that build it; a
change with no visible surface drops it. The description calls the shape a guide
rather than a form: `Context`, `Approach`, `Visual`, and `Risks` are dropped when
they have nothing to say, while `Steps` and `Verification` are kept, because the
steps are read from that section (without it, the shallowest list anywhere
becomes the steps) and Verification becomes the last todo item. Within `Steps`
only the shallowest list is tracked, so nested bullets stay notes instead of
becoming todos. This is guidance only: any markdown is accepted, stored, and
rendered as written, and a refinement is asked to keep its section headings so
the review can still mark only what changed.

A plan with more than 50 top-level steps in its `Steps` section is refused with
the cap and the fix named, and nothing is written.

The file is the source of truth. On approval the model follows the plan file's
steps, and refinements rewrite the same file (`write_plan` with `plan_path`), so
the reviewed artifact is the executed artifact.

### `exit_plan_mode`

`plan_path` names the file `write_plan` returned; the tool reads it back and
presents it for approval. A hand-edited or older file whose step list is over the
cap is refused before the review screen. The user approves, keeps planning, asks
for a refinement, or exits plan mode without approving; the last keeps the plan
file for a later review and records no todo items or goal. The review also offers
**Exit plan mode (discard)**, which leaves plan mode without approving.

On approval, plan mode ends, write access returns, and the plan's steps go into
the todo list:

- Steps are the top-level numbered/bulleted items of the plan's `Steps` section,
  and approval records them with the `todo` tool (via `ctx.executeTool`). Steps
  marked `- [x]` (or `[DONE:n]`) seed as completed, nested sub-bullets are notes,
  and an indented line continues its step.
- The list is a merge, not a replacement: existing items keep their place and
  status, a step whose text is already there is skipped, and the tool's item cap
  defers the rest instead of dropping anything.
- The plan's `## Verification` section follows as the **last** todo item,
  summarized on one line (`Verify: …`) — a fenced block contributes its
  commands, not its fence lines. It is not a plan step, so it is ticked in the
  todo list rather than with `set_plan_steps`, and it never counts against the
  50-step cap.
- A plan without a `Steps` heading keeps the older rule — the shallowest list in
  the document — so prose bullets in a plan that follows the outline never become
  todos, and its verification bullets are already covered.
- Each seeded item is matched back to its step by text, so ticking a step with
  `set_plan_steps` completes the item too.

**Goal-aware.** While planning, the injected context restates a pursued session
goal as one bullet, so the plan is designed against the objective instead of
beside it. On approval, a goal the goal workflow left as a draft (`planning`) is
finalized from the plan's own `## Goal` section — falling back to the title —
through the `goal` tool, with no extra dialog, because approving the plan *is*
the decision. A session with no goal at all is given the same objective, also
without asking. An `active` or `achieved` goal is never rewritten: a final
objective is the user's. No path spends a model turn.

**A split, when the switch is on.** With `plan.split` enabled (off by default;
a `/bytefly settings` row), `exit_plan_mode` also accepts `units`: the plan's
slices, each with a name, path prefixes, a test, and the units it depends on. The
split is validated *before* the review opens, so a refusal costs no review, and
the review screen shows it as a read-only `Split` section; while the switch is
off, `units` is ignored with one note. On approval the team
is written into the plan as a `## Team` table — a sentence naming the lead's
unit, then one row per unit — and the result carries a roster card. A refinement
rewrites the plan, and with it the team ceases to exist until the plan is
approved again. See [Splitting a plan](#splitting-a-plan).

### `cancel_plan_mode`

Leaves plan mode without a plan file or a review. Restores write access, records
no todo items or goal, and keeps any saved plan. Empty schema.

### `set_plan_steps`

Keep an approved plan current: `plan_path`, plus `updates`, each a 1-based `step`
in the order `exit_plan_mode` listed, a `status` of `pending` or `completed`, and
`expected` — the step's text, so an update whose step number moved is refused
instead of ticking the wrong line. It is a single all-or-nothing write: a step out
of range, or an `expected` text that no longer matches the file, refuses every
entry. Only the checkboxes change, and a reopened step drops its `[DONE:n]`
marker.

The todo item approval seeded from a step is ticked with it: the file is written
first and is authoritative, a renamed item is left alone and reported as
unmatched, and a failed todo write is reported in the result. The tool refuses
while plan mode is on — refine the plan with `write_plan` instead.

### Transcript

The three tool rows reuse the transcript component, and `exit_plan_mode`
separates the plan body from its header with a blank line; the collapse hint
binds to `app.tools.expand` (`ctrl+o` by default).

```
enter_plan_mode requested plan mode
✓ Plan mode enabled
```

```
write_plan Add rate limiting
✓ Saved plan ~/.pi/agent/plans/a1f9c02/2026-10-09-1809-add-rate-limiting.md
```

```
exit_plan_mode submitted a plan
✓ Plan approved
~/.pi/agent/plans/a1f9c02/2026-10-09-1809-add-rate-limiting.md

# Add rate limiting
1. Add a token bucket …

… 12 more lines (ctrl+o to expand)
```

## Commands and flags

| Path | Who starts it | Confirmation |
|---|---|---|
| `enter_plan_mode` tool | the model, before a non-trivial task | `ctx.ui.confirm` |
| `/plan` | the user | immediate |
| `/plan <prompt>` | the user, with the task | immediate |
| `/plan list` | the user, browsing the plans directory | immediate |
| `/plan review [path]` | the user, reviewing a plan in the browser | immediate |
| `/plan share [stop]` | the user, handing the review to a teammate | immediate |
| `/plan cancel` | the user, leaving plan mode without approving | immediate |
| `/skill:init` | the user, creating or updating `AGENTS.md` | enters plan mode; write waits for plan approval |
| `Ctrl+Alt+P` | the user | immediate |
| `--plan` | the user, at launch | immediate |

`/plan` with no argument toggles plan mode; `/plan <prompt>` enters it (if it is
not already on) and sends the rest of the line as the task, so the first turn
already runs read-only:

```bash
/plan add rate limiting to the public API
```

`/plan <prompt>` never disables plan mode; only the argument-less `/plan` (or
`Ctrl+Alt+P`) toggles. Because slash commands go through Pi directly, `/plan` is
the toggle that works in every terminal (for example Zed's integrated terminal,
which does not forward `Ctrl+Alt+P`). The footer shows `≡ plan` while plan mode
is on, and `≡ plan · <plan-file>` once the model has written a plan.

`/plan list` walks the plans directory and shows every plan with its title,
modified time, and step progress, newest first — in the TUI as a docked list
where `Enter` opens the plan's review, elsewhere as a notice with each plan's
path. The directory stays the index: no registry file, one bounded read per plan.

`/plan review` is the only subcommand that takes an argument. Bare `/plan review`
reviews the plan this session wrote, or, in a later session, the newest plan file
in the plans directory (newest modification time); `/plan review <path>.md` (or a
path with a separator) reviews that plan. A line that merely starts with the word
— `review the auth flow` — is still treated as a planning task, so the subcommand
never swallows one.

`/plan share` prints the reviewer link and its QR, and `/plan share stop` revokes
every link; the page's **Share** button does the same. With no browser review open
it says so and points at `/plan review`. `/plan cancel` leaves plan mode without
approving, exactly like `cancel_plan_mode`: write access returns and the plan file
stays for a later review. Both are exact words — `share the tokens` and `cancel
that idea` stay tasks — as is `list`.

### `/skill:init`

`/skill:init` loads the packaged `init` skill. The skill enters plan mode itself
when it is not active, then decides what to do; nothing is written before
approval. Its workflow is:

```text
/skill:init
  └─> plan mode (read-only)
        └─> recon: effective instruction file, sourced evidence, existing instructions
        └─> interview: built-in bank, one call of at most 4 questions, minus resolved facts
              ├─ answered ───────────────> reconcile with evidence
              └─ unavailable/cancelled ──> evidence + assumptions
        └─> draft: new file, exact edits, or an honest no-op
        └─> quality gate
        └─> write_plan ──> exit_plan_mode
                             ├─ not approved ──> refine the same plan
                             └─ approved ──────> write/edit the target
                                                 └─ read back + quality checklist
```

The interview comes from a built-in bank in
[`skills/init/references/interview-questions.md`](../../skills/init/references/interview-questions.md):
core questions cover purpose, verification, non-obvious rules, isolation,
completion, sensitive paths, and dependency or network limits, with state-specific
entries for an existing file, an empty repository, related instruction files, and
a shadowing override. The first call uses the bank's deterministic set for the
state, minus every field the evidence sheet resolved; a second call is allowed
only for a material ambiguity. If the tool is inactive, there is no UI, or the
user cancels, the skill records the gaps as assumptions and continues from
repository evidence.

Recon resolves the effective instruction file first: a root `AGENTS.override.md`
replaces `AGENTS.md` and becomes the target, while an override above the project
root is reported rather than edited. Recon also builds a sourced evidence sheet —
commands with the file that defines them, generated and vendored paths from
`.gitignore`, workspace packages and boundaries, and purpose from the README or
manifest — and the interview asks only what it could not resolve. The plan uses
the canonical outline, including `## Steps` and `## Verification`, so approval
seeds the apply actions rather than the draft's bullets.

The quality reference is
[`skills/init/references/agents-md-quality.md`](../../skills/init/references/agents-md-quality.md).
An existing instruction file is reviewed and updated only after approval, a root
override is edited in place or removed explicitly when consolidating, an accurate
file can produce a no-op plan, and an empty repository gets only known facts. It
never invents commands.
The skill needs the plan extension for its review gate. It also ships with the
package, so load the whole package (`pi -e .`) or install it; loading only
`./extensions/plan` leaves `/skill:init` unavailable.

## Routes

The browser review serves these routes on its loopback origin; `…` is the
session token, and the owner's token is the one that opened the page.

| Route | Result |
|---|---|
| `GET /?token=…` | the review page (a JSON data island plus `/theme.js` and `/client.js`) |
| `GET /theme.js` | the shared pre-paint theme bootstrap |
| `GET /client.js` | the first-party client script |
| `GET /events?token=…` | Server-Sent Events stream: a `comment`, `plan`, or `share` frame when something changed, `closed` when the review ends, `revoked` when sharing stops, and a dropped stream to detect a closed tab |
| `POST /api/comment?token=…` | reviewer only: write their own comments into the plan, replacing only their own; never ends the review |
| `POST /api/feedback?token=…` | owner only: write the owner's comments and return to the model |
| `POST /api/approve?token=…` | owner only: save, then approve |
| `POST /api/cancel?token=…` | owner only: end the session without saving |
| `POST /api/share?token=…` | owner only: mint the first reviewer link and its QR |
| `POST /api/share/link?token=…` | owner only: mint one more reviewer link, so each teammate holds their own |
| `POST /api/share/revoke?token=…` | owner only: revoke one link by `{ id }`, leaving the others answering |
| `POST /api/share/stop?token=…` | owner only: revoke every reviewer link |

## Behaviour by mode

The review screen is TUI-only: `exit_plan_mode` opens `PlanViewComponent`, and `w`
on it opens the browser review. RPC and other non-interactive runs get no screen.

Dialog-capable non-TUI modes (RPC/WeChat) use one editor prompt instead: on a
remote turn the plan file is sent first, then a compact prompt carrying the
title, step count, first steps, mode status, and three actions — `1` approve,
`2` keep planning, `3` exit. If the upload fails, the plan's text is sent
instead. Any other reply is a refinement, so "select Refine, then type" is gone.
A WeChat turn takes the same dialog path and is answered over
WeChat, even though the session is in TUI mode: the choice comes from
`askHuman(ctx, { custom, dialogs, body })` in `lib/interaction.ts`, not from
`ctx.mode`. Without any UI the tools fail with an actionable message instead of
deciding for the user.

`/plan list` is a docked list screen in the TUI and a notice with each plan's
path everywhere else.

Browser review is a local-turn feature: the server binds `127.0.0.1`, so a remote
(WeChat) turn cannot reach it and `/plan review` there refuses with a notice
instead of opening a server nobody can use. The browser's **Approve & run** is
offered only for the review `exit_plan_mode` opens, since only that flow owns
leaving plan mode; `/plan review` stays comment-only.

Aborting the turn closes a browser review. `exit_plan_mode` forwards the call's
abort signal to the review server, so an aborted turn returns "not approved"
and stops listening instead of waiting on a page nobody is watching.

## Configuration

One key, in the `plan` section of the shared `bytefly.json` (global document,
then project document, project wins; resolution rules in
[`../configuration.md`](../configuration.md#plan--parallel-slices)):

| Key | Default | Meaning |
|---|---|---|
| `split` | `false` | Let an approval carry a `## Team` table of slices that separate sessions join by name. |

The switch is also the `/bytefly settings` row **Split plans into slices**. With
it off, approval treats every plan as one flow.

## Security

Plan mode is a **guard rail, not a sandbox**: extensions run with Pi's OS
permissions, so it prevents accidental writes while planning, not a hostile
command. The read-only guarantee is layered:

- **Tool set at entry.** Tools that are not read-only are removed from the active
  set or blocked. `write` and `edit` are hidden, raw shell is limited to read-only
  git commands through `bash` (chained with `&&`/`;`), `powershell` is blocked
  outright, and other mutating tools (worktree mutations, MCP tools) are blocked
  until you exit plan mode. `subagent` stays active but is forced read-only. The
  only permitted write is the plan control tool `write_plan`, which can only
  create or overwrite markdown plan files directly inside the plans directory —
  never dotfiles and never through a symlink.
- **Capability policy.** A tool is allowed only when it is a known structured
  reader or declares the MCP `readOnlyHint`; `write`, `edit`, and unknown
  mutators are denied. Classification defaults to *deny* and is driven by the
  shared [`lib/policy.ts`](../../lib/policy.ts), so unknown tools are safe by
  default and the MCP `readOnlyHint` is the only thing that opens one up.
- **Path backstop.** A `readOnlyHint` is only a claim, so a tool that takes a
  file path is refused unless it is a known plan-safe reader. `path-guard.ts`
  scans nested arguments and path-shaped values, not just fixed top-level keys.
- **Control-tool identity.** The `tool_call` guard exempts `write_plan` /
  `exit_plan_mode` only when the registered tool is this extension's own,
  matched by source path, so a same-named tool from another extension cannot
  borrow the exemption.
- **Contained writes.** `write_plan` only writes markdown non-dotfiles whose
  real parent resolves inside the plans directory, and every plan write —
  create, refine, `set_plan_steps`, browser feedback — goes through a hidden
  temp file followed by a rename, so an interrupted write cannot leave a
  truncated plan.
- **Sanitized model text.** The plan file is model-authored, so `exit_plan_mode`
  strips control characters from the plan body before rendering it in the
  transcript and in non-TUI notices; a plan file cannot drive the terminal.
- **Loopback browser review.** The review server binds `127.0.0.1` and requires a
  random per-session token in the URL, rejects a missing or foreign `Host`
  header, serves only `GET`, `HEAD`, and `POST`, and caps the request body; the
  page renders plan and comment text with DOM text nodes, never `innerHTML`, so a
  plan cannot script the reviewer. The page also refuses to be framed
  (`frame-ancestors 'none'` and `X-Frame-Options: DENY`), so a local page cannot
  clickjack **Approve & run**.

## Read-only git shell

Plan mode does not run a general shell. `bash` stays active only so the model
can run **read-only git commands** — for example `git status`,
`git diff --stat`, `git log --oneline`, `git show HEAD`, or `git branch -a`.
Several may be chained with `&&` or `;` in one call, but every segment must
itself be a read-only git command, so a chain only combines allowed reads.
Anything else (a non-git command, a mutating git subcommand, a piped or
redirected command, substitution, or a conditional `||`) is blocked by a
conservative allowlist in `git-bash.ts`. `powershell` is not allowed at all, so
plan mode uses Git Bash on native Windows: the same read-only git commands work
there, and a backslash before an ordinary character is accepted as a Windows
path separator while a backslash that escapes a metacharacter is still refused.
Everything else uses `read`, `grep`, `find`,
`ls`, and the other read-only tools already available (`web_search`,
`web_fetch`, `ask_user_question`, `todo`, `goal`).

```bash
git status && git diff --stat     # allowed: two read-only git commands
git status; git log --oneline -5  # allowed
git diff -- extensions\plan      # allowed: a Windows path separator
git status && rm -rf x            # blocked: the second segment is not git
git status | sh                   # blocked: pipes are never allowed
git diff > out.patch              # blocked: redirection is a write
```

A refused shell command explains the fix: the working directory is already the
project root (so `cd` is unnecessary), and files belong to the `read`, `grep`,
`find`, and `ls` tools.

A string parser can never be the boundary, so capability gating replaced the
earlier segment-based command allowlist. The git shell guard is a narrow,
deliberate exception — an allowlist over read-only git command shapes, not a
general shell parser. If you need anything else during a plan, exit plan mode
first or wait for approval.

## Read-only delegation

While planning, `subagent` stays available but every call is **forced
read-only**. Plan mode sets `readOnly: true` on the call in the `tool_call`
guard, and `subagent` in turn gives each spawned agent a reader-only `--tools`
list (`read`, `grep`, `find`, `ls`, `web_search`, `web_fetch`). The child
process enforces it, so a delegated `explorer`, `researcher`, or even `worker`
cannot write, edit, or run a shell — regardless of its prompt or an external
agent file that overrides it.

```jsonc
// The model just calls subagent; plan mode supplies the readOnly flag.
{ "agent": "explorer", "task": "Map how the plan extension gates tools" }
```

- A `subagent` whose registered schema does not declare `readOnly` is refused
  (default-deny), so an old or unrelated tool cannot be run read-write while
  planning.
- The delegated run keeps its own isolated context window, so broad exploration
  does not fill the planning session.
- `readOnly` is also a normal `subagent` parameter; outside plan mode a caller
  may set it to run any agent read-only on purpose.

## Splitting a plan

Off by default: enable **Split plans into slices** in `/bytefly settings`, or set
`"plan": { "split": true }` in the project's `.pi/bytefly.json` so a repository
switches its own team on.

```text
exit_plan_mode({
  plan_path: "~/.pi/agent/plans/a1f9c02/2026-11-04-1802-billing.md",
  units: [
    { name: "contract", paths: ["src/billing/contract"], test: "bun test src/billing/contract", lead: true },
    { name: "core", paths: ["src/billing/core"], test: "bun test src/billing/core", dependsOn: ["contract"] }
  ]
})
```

The result prints the roster card, which is all the package can do for the sessions
it cannot start — and the one line it can act on for the session it is in:

```text
Split: 2 units · ~/.pi/agent/plans/a1f9c02/2026-11-04-1802-billing.md
  You start and switch every session; nothing here can.
  core: enter_worktree core · /sessions name core · /sessions watch wake
    session({action:"join", team:"2026-11-04-1802-billing", unit:"core"})
  merge order: contract → core · your unit: contract
  your label: none — name this session: session({action:"name", label:"contract"})
```

The last line is the lead's own label. The card's other lines are for the sessions
the user starts; this one is the lead's own, so it names the label when the session
already has one, and otherwise prints the rename to run. Once set, it reads
`your label: billing-lead — owners send their report there`, which is what an
owner addresses its completion report to.

What the gate enforces, and why each rule is a refusal rather than a warning:

| Refusal | Why |
|---|---|
| fewer than two units | One path is not a split: approve as one flow, or build the thinnest end-to-end path first. |
| overlapping prefixes | Two owners on one path is a merge conflict by construction. |
| a `dependsOn` cycle | No unit can start. |
| more than two owner units | The user switches to every owner each round; three means the split is wrong. |
| a unit with no test | The unit's definition of done would be undocumented. |
| an owner unit claiming a shared file | `package.json`, the changelog, the test manifests, and the shared name modules belong to the lead. The same list refuses that owner's `claim` through `session-bus`, so the rule outlives approval. |
| no unit marked lead | The approving session needs a unit of its own, or it is a queue. |

Refusals name the pair they caught, and a value that would break the `## Team`
table is refused with them.

The table itself is a wire format: [`session-bus`](./session-bus.md) parses it with
the same module that writes it, so a hand-edited or stale section is refused
rather than half-read. The browser review cannot approve a split plan — a section
written at approval has no source lines for its comments to anchor to — so the
terminal review is where a split is approved.

## Review screen

<img src="../../assets/plan.png" alt="The terminal plan review: a Plan Review title rule, a notice that one section changed since the last review, the plan body with its headings and ◼/◻ task checkboxes, a scroll gauge naming the current section and the visible line range, and the Esc/a/r/w, scroll, and section-jump hints" width="100%">

`exit_plan_mode` opens this screen on the plan file it just wrote. The body is
rendered with Pi's own `Markdown` component and `getMarkdownTheme()`, so
headings, lists, inline code, code blocks, links, and quotes carry the active
theme's colours; task items get the shared `◼` (done) or `◻` (pending) marker,
like the bytefly screen and the question dialog. A plan taller than the terminal
scrolls under a gauge that names the section at the top of the viewport and the
line range it shows, and the footer lists only the keys that apply.

- **Actions.** The footer colours the primary actions (`a approve & run` in
  `success`, `r refine` in `accent`). `a` asks `y/N` in the footer, then ends
  plan mode, restores write access, and seeds `todo`; `y` or `Enter` approves and
  `n`, `q`, or `Esc` goes back to reading. `r` keeps the plan mounted and opens
  an inline editor beneath it (`Enter` submits, an empty buffer does nothing,
  `Esc` returns to the plan); `Esc` keeps planning and tells the model the plan
  was not approved; `x` leaves plan mode without approving and keeps the plan
  file; `w` opens the browser review.
- **Sections.** The screen splits the body at its headings, names the section you
  are in, and jumps between sections with `n`/`p`; the scroll row names the
  current section when the plan has more than one.
- **What changed since the last review.** After a refinement, the screen names
  how many sections changed, marks the current one in the scroll row, and the
  browser outline dots each changed section, so a re-review does not mean
  re-reading the whole plan. The baseline is one digest per heading section of
  what the previous review showed, kept as a session entry, so a resumed session
  or a `/tree` restore marks only what changed on its own branch.
- **Scrolling.** `↑`/`↓` or `j`/`k`, `space`/`b` or `PgUp`/`PgDn`, `d`/`u`,
  `g`/`G`, and the mouse wheel. When the plan overflows, a gauge row above the
  hints shows the scroll position, the percent, and the visible line range (the
  range drops first on a narrow terminal); the gauge comes from the design
  system's `gaugeBar` and stays visible while the refine editor is open, since the
  body above is still clipped.
- **Narrow widths.** Hints are dropped whole as the terminal narrows, and each
  footer leads with its safe exit (`Esc keep plan` in the review, `Esc back to
  plan` in the inline editor) so the exit survives even when only one hint fits.

## Browser review

<img src="../../assets/plan-review.png" alt="The browser-based plan review: a sticky header with the plan title, a status chip, and the Approve & run, Save feedback, and Back to Pi actions, a Share action, a side panel with step progress and a section outline, and the plan as one measured column with a comment rail holding the owner's own comment and a teammate's @priya comment" width="100%">

Press `w` on the review screen — or run `/plan review [path]` — to open the plan
in the default browser on `127.0.0.1`. The page is a reading-first review
surface: a sticky header carrying the plan's H1 (falling back to the file-name
slug), a live status chip (connection, comment count, and unsaved changes), the
theme toggle, and the review actions, over a hairline reading-progress bar. A
sticky side panel shows the plan's `Steps` section progress and comment count above a
**section outline**, and the document is GitHub's Markdown content column — one centred
measure of at most 1012px with a comment rail in its left margin. Every block
reveals a **+ Comment** action on hover; select
text first to quote it. **Save feedback** writes the comments into the plan
file and returns them to the model.

- **Shared theme.** The page uses the same Bytefly tokens, base rules, and
  syntax-token colours as `file-browse` (`lib/web/`), follows the system light/dark
  preference until the header toggle sets an explicit choice, and remembers that
  choice under the shared `pi-web-theme` key.
- **One content column, one rail.** The document is GitHub's Markdown content
  column (a centred measure of at most 1012px), so a plan reads the way the same
  file does on GitHub; each block carries its `+ Comment` button and
  comment-count badge
  in a rail in the left margin, so annotating never reflows the text.
- **Section outline and facts.** Headings become a sticky outline with jump
  links, an active-section highlight, and a per-section comment count; the panel
  above it reports the `Steps` section's progress (`n/m`, the same list approval
  seeds) and total comments. A
  section that changed since the previous review on this branch carries a dot
  (its `title` and accessible label say so); an unchanged plan shows none.
- **Inline threads.** A comment renders directly under the block it anchors to,
  labelled and indented as a thread, so it reads in place and the plan keeps one
  measure at every width. There is no separate column to reflow.
- **Nothing typed is lost.** **Save feedback**, **Approve & run**, and **Back to
  Pi** refuse while a composer holds text and put the cursor back in it, a
  deleted comment is offered back in the header for a few seconds, and this tab's
  unsaved work survives a reload: the comments it added and the text still in its
  composer are kept in `sessionStorage` under a digest of the plan text the page
  rendered, then restored on the next load of that same text with the composer
  reopened at the caret and the selection it quoted, and dropped when the plan
  changed underneath them. A composer closed with `Esc` or **Cancel** discards its
  text, so only an abandoned tab gets it back. Nothing is stored on the server, and
  another writer's comment is never part of the draft.
- **Prints as a document.** Printing uses the light palette whatever the screen
  shows, drops the header, panel, rail, and progress bar, and lets the comments
  stay with the blocks they belong to.
- **Keyboard first.** `j`/`k` move to the next or previous block, `c` comments
  on the current block, `a` approves (the approval flow only), `s` saves, `Esc`
  closes the composer or the sheet and then the review, and `?` opens a shortcut
  sheet; the header's `?` button opens the same sheet. Adding, editing, or
  deleting a comment rebuilds the document, so the tab stop returns to that
  block's comment control instead of being dropped, and the status line says
  which change landed; a repaint the stream caused never moves focus. Either
  dialog traps `Tab` and hands focus back to whatever opened it.
- **Decision in place.** A review opened for approval (`w` on the review screen)
  shows **Approve & run** beside Save feedback: it persists the current comments,
  ends plan mode, restores write access, seeds `todo`, and hands control back to
  the model. Because that cannot be undone from the page, the button and `a`
  open a confirmation that says what happens and starts on **Cancel**; only its
  own **Approve & run** posts. **Save feedback** keeps plan mode and returns the
  comments as a refinement; **Back to Pi** closes the review with no decision.
  Each action settles the page on a terminal state — `Approved`, `Saved`, or
  `Closed` — so the tab never falls to Offline. `/plan review` is comment-only:
  it renders no approve action and the server refuses one.
- **Markdown that reads.** Headings, lists, task items, blockquotes, fenced
  code, GFM tables, `---` rules, and bare-URL autolinks render; a list item's
  continuation lines hang under the item's text, inline code is a soft fill
  rather than a bordered chip, tables honour the alignment row and scroll
  horizontally when narrow.
- **Highlighted code.** Fenced code is tokenized by the shared
  `lib/highlight.ts`; the client copies only text and `tok-*` spans through
  `DOMParser`, so a code line is never parsed as markup.
- **The file is the store.** Each comment is written as
  `> [!REVIEW] <comment>` on the line after the block it anchors to, tagged with
  its author when a teammate wrote it (`> [!REVIEW] @alice: <comment>`). Saving is
  idempotent per writer: that writer's previous markers are replaced and everyone
  else's are kept, so two people reviewing the same plan cannot erase each other.
  Stripping is fence-aware: a `> [!REVIEW]` line inside a code block is
  documentation, not feedback. The file is the only copy of a saved comment; the
  ones this tab has not saved yet live in its own `sessionStorage` and nowhere else.
- **A revision keeps the review.** `write_plan` passes the file it is replacing
  through `carryFeedback`, which re-attaches each comment by the strongest evidence
  that survived: the anchored block's text, per occurrence, so a plan that repeats
  a step keeps the comments apart; then the block whose wording still overlaps it —
  half the longer block's words — so a reworded step keeps its note, and a step
  that shifted down under an inserted one keeps it too; then the gap it left
  between the steps that survived; then the last block that section still has. A
  comment whose section is gone too moves to the plan's last block rather than
  disappearing, and every one of those placements lands beside a block, never after
  a blank line, so the page keeps the thread under its block. Only a plan with no
  block at all leaves a comment in the unattached list.
- **Anchored to source.** `blocks.ts` splits the plan (fence-aware) into
  source-line ranges; a comment is placed after the whole anchored block, so a
  fenced code block is never split. A save re-checks the file against what the
  page rendered and answers `409`; the page then offers a **Reload** action,
  because only a reload can re-anchor the comments to the new text.
- **Back to the model.** A save from the review screen returns `refined: true`
  with the comments, so the model stays in plan mode and revises the same file. A
  save that carries no comments asks for nothing, so the review screen comes back
  instead. `/plan review` sends them as a user message (a plan-mode revision or a
  plain update, depending on the mode).
- **Loopback first, tokenized.** The server binds `127.0.0.1`, carries a random
  per-session token in the URL, rejects a `Host` header it was not bound on,
  refuses a cross-origin POST, serves only `GET`, `HEAD`, and `POST`, and caps the
  request body. Sharing adds a second listener (below); it never widens the first. A save or cancel
  resolves the session only after its HTTP response is delivered, so the browser
  never sees a false "Failed to fetch". The last bound port is remembered per
  plan, so reviewing the same plan again reuses the origin (and the browser's
  saved theme with it). It is closed on the owner's save or cancel, on the owner's
  page going away, or on `session_shutdown`; a reload reconnects inside that grace,
  so refreshing or reloading a conflicted page does not end the review. A
  reviewer's tab opening or closing is not the review's lifetime.

The routes it serves are in [Routes](#routes).

## Shared review

A review is not only the owner's. **Share** in the review header (or `/plan share`)
mints a reviewer link, binds a second listener on the machine's first reachable
IPv4 address, and shows the link with a QR a phone can scan. **New link** in the
same dialog mints one more, so each teammate holds a link of their own. **Stop
sharing** revokes every link and closes that listener; closing the review does
both.

- **Two roles, one token each.** The owner's token — the one the browser opened
  with — decides: it may comment, save (which returns to the model), approve,
  cancel, mint links, and revoke them. A reviewer token may read and comment, and
  its one write route is `POST /api/comment`: `/api/feedback`, `/api/approve`,
  `/api/cancel`, and the `/api/share` family answer `403`, and the page renders
  only the name control and **Post comments** for it — and once that link has
  posted, the control shows the bound name instead of offering the dialog.
  Anything the reviewer holds is reachable only while its link is shared.
- **One link is one person.** The dialog lists every link with the name it has
  bound, and the two things an owner does with one: **Copy**, and **Revoke**, which
  drops that link alone — its page is told `revoked` and its token stops
  answering, while the others keep working. Revoking the last link stops sharing.
  A review holds at most eight links, because each is a live credential.
- **The owner's page is the review's lifetime.** A reviewer's tab opening or
  closing changes nothing; the review ends when the owner saves, approves, or
  closes it, or when the owner's own page goes away. A reviewer's post writes the
  plan and updates every open page, and leaves the review waiting. A page that is
  still open when the review ends is told why — `closed`, or `revoked` when its
  link was revoked or sharing was stopped — and keeps the plan readable.
- **Signed comments.** A reviewer names herself once, on the page, and that name
  is bound to her link on its first post: the link stores under it from then on,
  a second tab of the same link that picked another name is refused (`409`) rather
  than silently re-signing, and a name another live link already holds is refused
  when it is first claimed. A bound name is shown, not offered, so a reviewer can
  edit or withdraw her own notes and nobody else's, and her second post replaces
  rather than duplicates the first. The name is a label on a bearer link, not an
  account, which is why the owner still makes the only decision.
- **One listener, one machine.** Sharing opens exactly the address the dialog
  printed — never `0.0.0.0` — and the `Host` allowlist becomes loopback plus that
  address, however many links answer on it. A machine with no reachable IPv4
  address reports why instead of printing a link that cannot work. There is no
  tunnel, no relay, and no cross-machine sync: this is the same Wi-Fi.
- **Live.** Every open page follows the stream, so a reviewer's post appears on the
  owner's page without a reload. The review also polls its own plan file once a
  second, so an edit this review did not make — the model rewriting the plan while
  `/plan review` is open in normal mode, or a teammate's editor — repaints every
  reader instead of waiting for the next request, and a save that changed nothing
  but comments stays quiet. A page with a draft open refuses to repaint and says
  what arrived instead. The owner's terminal is told too — `Plan review: @alice
  posted 2 comments.` — because whoever is waiting in the TUI is not looking at
  the page.
- **What a shared link is.** A bearer credential: anyone who has it reads the plan
  and can comment, under the one name it binds on its first post. The dialog says
  so, `Referrer-Policy: no-referrer` keeps a click from leaking it, and **Revoke**
  (or **Stop sharing**) is the revocation. The plan file is the record — a comment
  arrives as an author-tagged marker, so `/resume` and the terminal show the same
  review the page did.

## Limitations

- PowerShell is not available while planning. On native Windows the shell is
  Git Bash (`bash`), which must be installed for any shell command to run.
- The read-only guarantee is a guard rail against accidental writes, not a
  security boundary (see [Security](#security)).
- The plans directory is the only index. `/plan list` walks it on every open and
  keeps no registry, so it sees an external edit or a hand-copied plan
  immediately; it lists a file over the 256 KiB plan limit without reading it,
  and does not index the agent directory's plans while a worktree is active.
- Approval tracks at most 50 steps: `write_plan` refuses a larger plan, and
  `exit_plan_mode` refuses to present one, so no reviewed step is silently
  dropped. A step longer than 200 characters is shortened in the todo list and
  the approval listing — a display rule only, because the plan file always keeps
  the full text.
- The todo item for a step is matched by its text. An item renamed after
  approval no longer matches, so `set_plan_steps` leaves it alone and says so in
  its result; the plan file is still updated.
- Browser review needs a local browser: the server is loopback-only, so a remote
  turn cannot drive it.
- A browser that never connects leaves the review waiting until the user
  cancels, closes the tab, or aborts the turn.
- Feedback stripping follows fenced code blocks; an unterminated fence makes the
  rest of the file code, so a marker-looking line after it is treated as content
  rather than stored feedback.
- A comment is one line. Stored feedback is a single blockquote line, so newlines
  and runs of spaces collapse before it is written; a pasted multi-line
  instruction reaches the model as one sentence, which is what keeps the marker
  grammar valid markdown.
- The plan-file poll runs once a second, so an edit made elsewhere reaches an open
  page within about that long, and a write that leaves the plan's text identical —
  another process appending only a comment — is not announced; the next save still
  refuses a file it did not render (`409`). It is a poll rather than a file
  watcher, so a change on a filesystem that reports nothing at all is still seen
  at the next request, because every page read re-compares the file.
- A shared review holds at most eight links. Each is a live bearer credential, so
  a ninth is refused with the cap named rather than minted.

## Non-goals

- **Not a sandbox.** Extensions share Pi's OS permissions.
- **No progress tracker of record.** `todo` owns completion state; the plan
  file only mirrors it (`set_plan_steps`), and plan mode does not read completion
  back out.
- **No auto-execution.** Approval hands control back to the model.

## Pi integration

| Integration point | How |
|---|---|
| Tools | `enter_plan_mode` (active; `readOnlyHint: true`), `write_plan` (`defaultActive: false`; `readOnlyHint: false`, `destructiveHint: true`), `exit_plan_mode` (`defaultActive: false`; `readOnlyHint: true`), `cancel_plan_mode` (`defaultActive: false`; `readOnlyHint: true`), `set_plan_steps` (active; `readOnlyHint: false`, `idempotentHint: true`). All five are `executionMode: "sequential"` and closed-world, and the read-only policy default-denies `set_plan_steps` while planning. Each returns typed `details` (`EnterPlanModeDetails`, `WritePlanDetails`, `ExitPlanModeDetails`, `CancelPlanModeDetails`, `SetPlanStepsDetails`), and `ExitPlanModeDetails` carries the review's `annotations` when a browser approval or save supplied comments; no `outputSchema`/`structuredContent`. |
| Commands and flags | `/plan` (toggle, or enter and send a task), `/plan list` (plans index), `/plan review [path]` (browser review), `/plan share [stop]` (reviewer link), `/plan cancel` (leave without approving), `/skill:init` (skill-backed `AGENTS.md` bootstrap), `--plan` launch flag, `Ctrl+Alt+P` shortcut. |
| State | Enabled flag and the tools it hid persisted with `pi.appendEntry("plan-mode", { enabled, removed })`, and each review's baseline persisted with `pi.appendEntry("plan-baseline", { path, sections })` as one digest per heading section; both rebuilt from `ctx.sessionManager.getBranch()`, so `/resume` and `/tree` restore the mode and the changed markers of the branch they land on. Plan writes a goal only at approval, through `ctx.executeTool("goal", { objective })`: a `planning` goal is promoted to the plan's `## Goal`, a session with none is given the same objective, and an `active`/`achieved` goal is left alone — no path asks first. A review that shows the same content appends nothing. The last plan path lives in runtime memory for the footer chip, and a bare `/plan review` falls back to the newest plan file in the directory. |
| Entry requests | `pi.events` channel `PLAN_ENTER_REQUEST` from `lib/plan-entry.ts`: the `goal` workflow asks, with the shared consent sentence, and plan enables the mode on the caller's context without a second dialog. Subscribed on `session_start`, released on `session_shutdown`. |
| Hooks | `tool_call` blocks non-read-only calls and forces `subagent` read-only; `before_agent_start` injects the hidden `[PLAN MODE ACTIVE]` context, with a pursued session goal read from the branch through `lib/goal-state.ts`; `context` keeps only the newest plan context while enabled and drops stale ones otherwise. |
| Lifecycle | `session_start`/`session_tree` restore state; `session_shutdown` clears the footer status and closes any browser review server. |

## Design notes

- **Consent is one dialog, whichever extension asks.** The goal workflow offers
  plan mode as a phase of the goal, but a command context cannot call
  `enter_plan_mode` (`ExtensionCommandContext` has no `executeTool`). So the
  consent sentence left `policy.ts` for `lib/plan-entry.ts`, and the entry itself
  is a `pi.events` request: the asker shows the question, plan enables silently
  with the asker's context. `enter_plan_mode` keeps its own confirm, using the
  same sentence, so the model-initiated path is unchanged and the two texts
  cannot drift. A request that nobody answers resolves `false` rather than
  hanging, so `goal` loaded alone still works.
- **One review loop owns the human gate.** `review.ts` asks however the session
  is attached — TUI screen, dialog plus editor, remote file plus digest, or
  browser — and returns one `ReviewDecision`, so `exit_plan_mode` and
  `/plan review` no longer carry two copies of the browser lifecycle and the
  tool's own `for(;;)` with a `continue` per outcome. The loop also owns the
  baseline rule (mark what the screen showed, after it showed it) and forwards
  the call's abort signal, which is what closes a review on an aborted turn.
- **Two tools, not one.** `EnterPlanMode`/`ExitPlanMode` are a pair: entering is
  consent to explore read-only, exiting is consent to act. A single toggle tool
  cannot express "the model wants to plan but the user declines".
- **User entry is instant, model entry confirmed.** `/plan`, `Ctrl+Alt+P`, and
  `--plan` are the user's own action and take effect at once; `enter_plan_mode`
  changes the mode on the user's behalf, so it confirms first.
- **Review the file, decide in a screen.** The plan is a file, so it is the
  artifact already on screen. `ctx.ui.confirm()` is a non-scrollable selector
  that pushes buttons off-screen for a long plan, so the TUI gets a scrollable
  review screen and dialog-capable modes get a `select` plus editor. The screen
  renders the body with Pi's `Markdown` component so the plan reads like any
  other markdown in the app; the plan text is sanitized before it reaches the
  renderer, so only the theme's own ANSI survives.
- **`write_plan` is the only write.** It is not the builtin `write`, so the
  capability policy and path backstop stay intact; a `plan_path` must name a
  markdown non-dotfile whose real parent resolves inside the plans directory,
  so symlinks and the directory's own `.gitignore` are never writable targets.
- **Approval seeds `todo` via `ctx.executeTool`.** The event bus carries no
  `ctx`, so a listener could not refresh the todo widget; calling the real tool
  runs its validation and widget sync and needs no change to `todo`. Only the
  top-level list items of the `Steps` section become steps (the whole document
  is the fallback when that heading is absent), and an indented line continues
  its step, so the outline's prose lists never seed the list. The list is
  whole-list replacement, so the current items
  are read back from the branch's last `todo` result (the published state
  channel; no import from that extension) and the steps are merged into them.
  A rejected seed reports the nested tool's own reason in the approval message
  instead of failing silently.
- **Ticking a step ticks its item, through the same channel.** The seed's text is
  the step's text (`PlanStep.content`, already elided for a long step), so the
  mirror matches on that text and changes only `status`: an item the user
  renamed is left alone and reported as unmatched rather than overwritten, and a
  repeated call writes nothing. The file is written first and stays
  authoritative, so a failed nested write is reported in the result text — once
  one artifact has changed there is no previous state to hand back.
- **A cap is enforced where it can still be fixed.** Both refusal points —
  `write_plan` and `exit_plan_mode` — sit before the write and before the review,
  because those are the moments the model can still regroup the steps. A note on
  a successful write would arrive after the file existed and the review had
  already listed every step, which is exactly when the overflow becomes lost
  work.
- **Changed markers compare what was shown, not revisions on disk.** A review
  result is only meaningful next to the text the reviewer already read, so every
  review marks the sections it presented (keyed by resolved path) and
  `plan-text.ts` compares the next plan against those digests. Stored feedback is
  stripped from both sides, so a review comment never reads as an edit, and the
  same helper feeds the terminal summary and the browser outline. The digests are
  a session entry rather than the previous text, so the markers survive a resume
  without copying the plan file into the branch, and the reader and the writer
  share one normalization so a tab cannot read as a change.
- **The outline guides, it does not enforce.** `write_plan` documents the
  canonical shape in its description and stores whatever markdown it is given;
  no section is required and nothing is rewritten. The description names the two
  headings that do carry behavior — `Steps` is what approval reads as steps, and
  `Verification` the trailing check — so the model is told the cost of dropping
  one instead of having the plan refused. The review's baseline is keyed by
  heading text, so a refinement is asked to keep its headings; a rename reads as
  an edit, which is the one change the markers cannot tell from a rewrite.
- **Sections are rendered one at a time.** Pi's `Markdown` exposes no
  source-line map, so `tui.ts` splits the body at its headings and renders each
  section separately. That gives exact offsets for the current-section label and
  `n`/`p`; the single-section case is byte-for-byte the old render.
- **`set_plan_steps` is a second contained write.** It changes only the named
  steps' checkboxes, in an existing markdown plan inside the plans directory
  (`isContainedPlan`), in a single all-or-nothing write — refusing every entry
  if any step is out of range or an entry's `expected` text no longer matches —
  and refuses while plan mode is on, so the read-only guarantee and the path
  backstop are unchanged. A required `expected` is what makes an ordinal safe:
  a plan edited between approval and ticking is caught instead of silently
  marking the step that moved into that number.
- **Direction: enforce capabilities at the tool boundary.** (1) A shared
  default-deny policy classifies every call as read-only or mutating instead of
  maintaining a mutator list. (2) Read-only delegation is enforced in the child
  process through `--tools`, not by trusting the agent name or prompt. (3) Raw
  shell is removed except the narrow read-only git allowlist in `git-bash.ts`;
  no general shell parser. (4) A recursive path guard blocks hint-carrying tools
  that take a file path unless they are known plan-safe readers.
- **State is a custom entry.** `{ enabled, removed }` is excluded from model
  context and reconstructed on start and tree navigation, so exiting plan mode
  restores the tools the branch it was left on hid; the `--plan` flag only
  applies when the branch has no persisted entry, so a later disable survives
  `/resume`.
- **Browser comments live in the plan, not a sidecar.** A review comment is a
  blockquote in the file the model already owns, so there is one artifact to
  read, revise, and approve; `blocks.ts` supplies the source-line anchors the
  existing heading-only split cannot, and the page renders text with DOM nodes
  so review never widens the plan's trust surface. The browser opener is shared
  through `lib/browser.ts` rather than imported from `file-browse`.
- **Comments render in the document flow, not a second column.** The anchor is
  already a source line, so the browser needs no paired column: a thread is
  appended after its block and the plan keeps one measure at every width. The
  per-block affordance lives in a narrow rail inside the measure's left margin,
  so annotating never moves the text. That removes the two-column grid, the
  `bf-review--no-rail` collapse, and the breakpoint ladder, and matches the TUI,
  where neither review header carries a progress counter.
- **A poll, not a file watcher.** An open review re-reads its plan once a second
  and announces when the text stopped matching what the page rendered, because the
  review owns the page and not the file: `/plan review` runs in normal mode, so the
  model can rewrite the plan underneath it. The house rule is a poll (see
  `file-browse`'s note): `fs.watch` is the one part of `node:fs` whose availability
  and event semantics differ per platform, and it would add a long-lived resource
  to start and release. The check only announces — it never writes `pageText`,
  which stays the anchor a save is validated against — so a save through the routes
  says nothing, and an announced edit can be announced once more by the read that
  repaints: that read is what updates `pageText`, so it converges instead of
  looping, at the cost of one extra refetch.
- **One link is one person, and the token table is the roster.** A shared review's
  unit of access is a link, not a room: a token names a role and binds the name its
  owner posts under, so two people on one link are one writer and the second name
  is refused. The owner hands out one link per teammate and takes one back without
  disturbing the rest, and the exit of a link is the exit of one token, one stream,
  and one marker author — which is why the streams are addressed by token rather
  than by role, and why the link table is pure and separate from the listener that
  answers on it.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Wiring: tools, command, flag, shortcut, events, context injection. |
| `types.ts` | `PlanModeEntry`, `EnterPlanModeDetails`, `WritePlanDetails`, `ExitPlanModeDetails`, `CancelPlanModeDetails`, `SetPlanStepsDetails`. |
| `policy.ts` | Plan mode's read-only policy, the shared prompt summary, and the bash-refusal guidance. |
| `git-bash.ts` | `checkReadOnlyGit`: the pure allowlist that restricts `bash` to read-only git commands. |
| `plans.ts` | Plan-file store: slug/stamp naming, directory resolution (repository, active worktree, or agent directory), containment, atomic `write`/`setSteps`/`saveFeedback`, and `read`/`latest`. |
| `split.ts` | The split at approval: the switch, the decision per `units` value, the roster card, and the `## Team` write. |
| `todos.ts` | Approval-time todo merge (pure): the last list replayed from the branch, and the merge of the plan's steps into it with the cap respected. |
| `steps.ts` | Plan-document structure (pure): the outline, step extraction and the `Steps`-section scope, heading sections, the plan's own goal (`goalSection`), and the checkbox edit. |
| `format.ts` | Pure result/approval text: the plan preview, the step-cap diagnosis, step labels, the merge summary, and the verification note. |
| `plan-text.ts` | The plan text a review shows and compares: `sanitizePlanText`, the one normalization both sides use, the per-section `sectionDigests`, and `changedSections`, which hands each section back with its flag. |
| `runtime.ts` | Enabled state, tool gating, persistence (mode and review baseline), control-tool identity, footer status. |
| `tools.ts` | Registration entry: composes the five tool registrations in the order the session sees them. |
| `tools/` | One module per tool (`enter.ts`, `write.ts`, `exit.ts`, `cancel.ts`, `steps.ts`), plus `todo-seed.ts` (the two nested `todo` writes) and `nested.ts` (reading a nested result). |
| `review.ts` | The review gate: one decision from the TUI screen, a dialog, or the browser, the shared browser lifecycle, and the "mark what was shown" baseline rule. |
| `review-prompt.ts` | Pure rendering and parsing for the compact remote review: one action table behind both the prompt and the reply parser. |
| `commands.ts` | `/plan` (enter, optional task), `/plan review [path]`, `/plan list`, `/plan share [stop]`, and `/plan cancel`. |
| `tui.ts` | `PlanViewComponent` (sectioned Markdown body, changed-section summary and marker, section jump, scroll gauge, the approve `y/N` question, approve/refine/browser/keep). |
| `plan-index.ts` | `/plan list`: the notice text and the docked index screen (title, step progress, age, focused path; Enter reviews). |
| `blocks.ts` | Source-line block model (fence-aware headings, paragraphs, list items, code, quotes, tables, rules, blanks), and `contentBlockAt`: the block with content a comment beside blank space belongs to. |
| `feedback.ts` | Comment codec: authored markers, `stripFeedback`, `readFeedback`/`parseFeedback` (body, blocks, and comments out of one parse), `formatFeedback` (writer-scoped), `displayFeedback`, `carryFeedback`, `feedbackSummary`, and payload validation. |
| `web.ts` | `createPlanWebReview`: the review session (per-token roles, the change stream, the plan-file poll, the body cap, settle-after-flush, abort) over `lib/http`'s one loopback server. |
| `web-tokens.ts` | The token table: the role each token names, the collision rule that keeps two roles off one token, and the names the other live links have bound. |
| `web-streams.ts` | The event streams: who is listening, what a frame is addressed to, and the closed-tab grace that ends the review when the owner's page goes away. |
| `web-router.ts` | Pure request handler: token role, `Host` allowlist, origin, and method checks through one POST-and-role guard, then the page, comment, owner-save, approve, cancel, and the four share routes. |
| `web-page.ts` | The review page shell (header, reading progress, review facts, section outline, shortcut sheet, approve confirmation, share and name dialogs), its data island, and inline CSS. |
| `web-share.ts` | Pure sharing rules: the reachable LAN addresses from an injected snapshot, one tokenized URL, the link table (mint, find, revoke, list, state) with its cap, and the reasons a share is unavailable. |
| `web-share-session.ts` | The shared listener: its bound address, the link table over the session's tokens, `ShareState`, and invite/revoke/stop/close, injected with the request handler, role map, and frame hooks. |
| `web-client.ts` | The `/client.js` source: state and wiring (comment rail, save/approve/back, keyboard nav, the stream's lifetime) over the three fragments below. |
| `web-comments.ts` | The client's comment half: selection quotes, the composer, authored cards and who may edit them, delete-with-undo. |
| `web-collab.ts` | The client's collaboration half: the link list with copy and per-link revoke, the reviewer's name, and the island refetch a stream frame triggers. |
| `web-markdown.ts` | The client's document half: `safeHref` and the inline/table/code/list rendering (interpolated into `web-client.ts`). |
| `web-chrome.ts` | The client's chrome half: the state chip, the status line, the header, and reading progress (interpolated into `web-client.ts`). |
| `path-guard.ts` | Recursive path-argument detection for the read-only backstop. |
| [`../../lib/plans/`](../../lib/plans/) | The plan document's shared shape: `sections.ts` (the one fence-aware scan, and the occurrence key that tells two identically titled sections apart), `team.ts` (the `## Team` codec), `split.ts` (`checkSplit` and its refusals), `store.ts` (`plansDir`), and `setting.ts` (the `plan.split` key), so approval and `session-bus` cannot disagree. |
| [`../../lib/browser.ts`](../../lib/browser.ts) | Cross-platform default-browser opener (shared with `file-browse`). |
| [`../../lib/plan-entry.ts`](../../lib/plan-entry.ts) | Plan-mode entry shared with `goal`: the read-only summary, the consent sentence, and the `pi.events` request `plan` answers by enabling the mode. |
| [`../../lib/shell.ts`](../../lib/shell.ts) | The shell-escape rule the read-only git guard shares with the worktree isolation guard. |
| [`../../lib/highlight.ts`](../../lib/highlight.ts) | First-party escape-first syntax tokenizer (shared with `file-browse`). |
| [`../../lib/qr.ts`](../../lib/qr.ts) | QR matrix, terminal half-blocks, and inline SVG for the share link (shared with `wechat`). |
| [`../../lib/http/`](../../lib/http/) | The one loopback server entry, the bind, `Host` allowlist, header sets, and response kit both browser surfaces serve through. |
| [`../../lib/web/index.ts`](../../lib/web/index.ts) | Shared Bytefly web brand system: tokens, base rules, `tok-*` colors, layout, the bootstrap, the toggle wiring, the shortcut sheet (`keysSheet`, `keysDialogScript`), and shared markup. |
| [`../../lib/http/index.ts`](../../lib/http/index.ts) | Loopback HTTP layer shared with `file-browse`: the page policy and header sets, `ServeResponse`, the request-envelope helpers, bind/respond/close. |
| `../../lib/policy.ts` | Shared read-only capability policy (default-deny + `readOnlyHint`). |
| `../../lib/tui/chrome.ts` | Shared screen header, viewport-row helper, and styled key-hint footer. |

## Testing

```bash
bun test extensions/plan
```

Ten co-located suites, declared in `test/suite-manifest.ts`:

- `plans.test.ts` — the plan-file store: naming, directory resolution, atomic
  writes, `read`/`latest`/`index`, containment, `setSteps`, `saveFeedback`, and
  step extraction.
- `feedback.test.ts` — the comment codec: authored markers, stripping and
  parsing, who a reviewer's write is signed by, carrying feedback onto a
  revision, and displaying stored comments.
- `tools.test.ts` — registration and all five tools, the approval merge into
  `todo`, the `## Team` write on a split approval, the session goal, and the
  call/result renderings.
- `review-prompt.test.ts` — the compact remote prompt and its reply parser
  against one action table.
- `web.test.ts` — the browser review: the comment codec, the router, the page
  roles and page shell, the client script, the stream, the plan-file poll, the
  share rules, and a real loopback session.
- `web-share.test.ts` — the LAN address selector, `shareUrl`, the link table with
  its cap, and the reasons a share is unavailable.
- `commands.test.ts` — `/plan review`, `/plan list`, `/plan share`, and the one
  review gate shared by `exit_plan_mode` and the browser, including the abort and
  baseline rules.
- `runtime.test.ts` — tool gating, persistence and status, control-tool identity,
  the review baseline, branch restore, the read-only git allowlist, and the
  path-argument scan.
- `tui.test.ts` — the review screen at fixed widths: Markdown body, scrolling,
  section navigation, the gauge, footer hints, the approve question, the inline
  refine editor, the `Split` section, and the changed-section markers.
- `extension.test.ts` — the Pi wiring: registration, the entry request, the
  session lifecycle, the tool-call guard, injected context, the command, and the
  shortcut.

The split rules and the `## Team` codec are shared with `session-bus`, so their
tests live beside them in `lib/plans/`: `split.test.ts`, `team.test.ts`, and
`sections.test.ts`.
