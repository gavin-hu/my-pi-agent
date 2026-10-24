# plan — file-backed planning for Pi

A read-only exploration mode modelled on Claude Code's `EnterPlanMode` /
`ExitPlanMode` pair. While plan mode is on, the model investigates and proposes,
but the only thing it may write is the plan file itself. The plan is saved under
`.pi/plans`; the user reviews that file, and it is the artifact the model
executes.

```bash
pi --extension ./extensions/plan   # load just this extension
pi -e .                            # load the whole @gavin-hu/my-pi-agent package
pi --plan                          # start in plan mode
```

## Tool rendering

How the `write_plan` and `exit_plan_mode` calls and their results look in the transcript — the call line as a headline and the body indented under it:

<img src="../../assets/tools/write_plan.png" alt="The write_plan tool's call and result: the call line and an indented body with the saved plan path and byte count" width="100%">

<img src="../../assets/tools/exit_plan_mode.png" alt="The exit_plan_mode tool's call and result: the call line and an indented body with the approval line and the approved plan preview" width="100%">

## What it does

- **Read-only gating, with one exception.** Tools that are not read-only are
  removed from the active set or blocked. `write` and `edit` are hidden, raw
  shell is limited to read-only git commands through `bash` (chained with
  `&&`/`;`), `powershell` is blocked outright, and other mutating tools (worktree
  mutations, MCP tools) are blocked until you exit plan mode. `subagent` stays
  active but is forced read-only. The only permitted write is the plan control
  tool `write_plan`, which can only create or overwrite markdown plan files
  directly inside the plans directory — never dotfiles and never through a
  symlink. Classification defaults to *deny* and is driven by the shared
  [`lib/policy.ts`](../../lib/policy.ts), so unknown tools are safe by default
  and the MCP `readOnlyHint` is the only thing that opens one up. A refused
  shell command explains the fix: the working directory is already the project
  root (so `cd` is unnecessary), and files belong to the `read`, `grep`, `find`,
  and `ls` tools.
- **Model entry point.** The model can call `enter_plan_mode` to ask for plan
  mode before a non-trivial task; the user confirms.
- **AGENTS.md bootstrap.** The packaged `init` skill (`/skill:init`) enters plan
  mode, reconnoiters the repository, runs one built-in interview of at
  most four questions, creates or updates `AGENTS.md`, gates the draft through a
  quality checklist, and writes only after plan approval. It supports existing and
  empty repositories, and falls back to evidence with recorded assumptions when
  the interview is unavailable or cancelled; it never invents commands.
- **Plan files.** The model saves the plan with `write_plan`; the file lands in
  `<repo-root>/.pi/plans/<YYYY-MM-DD-HHmm>-<slug>.md` — the entered worktree's
  root when one is active — or `<agent-dir>/plans` outside a repository. The
  plans directory is self-ignoring, so plan files never show up as untracked
  files or in `rewind` snapshots.
- **A discoverable index.** `/plan list` walks the plans directory and shows
  every plan with its title, modified time, and step progress, newest first — in
  the TUI as a docked list where `Enter` opens the plan's review, elsewhere as a
  notice with each plan's path. The directory stays the index: no registry file,
  one bounded read per plan.
- **A shape that reads.** `write_plan` documents a canonical outline — a
  `# <Title>`, then `## Goal`, `## Context`, `## Approach`, `## Visual`,
  `## Steps`, `## Risks`, and `## Verification` — and the model is guided to
  follow it. Every example in the template is the shape wanted rather than a
  description of it, and each section has one job: the goal is one sentence, the
  context is the facts that force the approach, the approach names the
  alternative it rejected, and verification is a fence of the commands to run.
  `Visual` carries the end state in an untagged fence, with one line naming what to
  look at: the same surface before and after when the change alters one that
  already exists, one frame when the surface is new, because a reviewer judges the
  result before the steps that build it; a change with no visible surface drops it.
  The description calls the shape a guide rather than a form: `Context`,
  `Approach`, `Visual`, and `Risks` are dropped when they have nothing to say,
  while `Steps` and `Verification` are kept, because the steps are read from that
  section (without it, the shallowest list anywhere becomes the steps) and
  Verification becomes the last todo item. Within `Steps` only the shallowest
  list is tracked, so nested bullets stay notes instead of becoming todos. This
  is guidance only: any markdown is accepted, stored, and rendered as written,
  and a refinement is asked to keep its section headings so the review can still
  mark only what changed.
- **Trackable steps.** Steps are written as `- [ ]` checkboxes in the `## Steps`
  section; approval seeds them into `todo`, with the `## Verification` section as
  the last item so the definition of done travels with the work. A plan with more
  than 50 top-level steps is refused rather than truncated, so approval never
  drops a step you reviewed.
- **A navigable review.** The review screen splits the body at its headings,
  names the section you are in, and jumps between sections with `n`/`p`.
- **What changed since the last review.** After a refinement, the review screen
  names how many sections changed, marks the current one in the scroll row, and
  the browser outline dots each changed section, so a re-review does not mean
  re-reading the whole plan. The baseline is one digest per heading section of
  what the previous review showed, kept as a session entry, so a resumed session
  or a `/tree` restore marks only what changed on its own branch.
- **Kept current.** After approval, `set_plan_steps` flips the checkboxes of
  the steps you name in the file, so the plan mirrors what has actually been
  done, and ticks the todo item approval seeded from that step with it, so the
  widget and the plan do not drift apart. Pass the step's text as `expected` and
  an update whose step number moved is refused instead of ticking the wrong line.
- **Reviewable plan.** `exit_plan_mode` reads the plan file back and presents
  it for approval. The user approves, keeps planning, asks for a refinement, or
  exits plan mode without approving; the last keeps the plan file for a later
  review and records no todo items or goal.
  On a remote turn (WeChat) the plan file is sent first, then one compact editor
  prompt: the title, step count, first steps, mode status, and three actions
  (approve, keep, exit). Any other reply is a refinement request; if the file
  upload fails, its text is sent instead.
- **Browser review on demand.** Press `w` on the review screen (or run
  `/plan review [path]`) to open the plan in a local browser: a reading-first
  page with the plan's H1 as its title, GitHub's Markdown content column, a
  comment rail in
  the left margin, and live section and step progress — the step count comes from
  the same `Steps` section list approval seeds. Select text to leave an
  inline comment, and save them back into the plan file itself as
  `> [!REVIEW]` lines. Saved comments return to the model as a refinement
  request.
- **The file is the source of truth.** On approval the model follows the plan
  file's steps; refinements rewrite the same file (`write_plan` with
  `plan_path`), so the reviewed artifact is the executed artifact.
- **Steps become todos.** On approval, the top-level numbered/bulleted items of
  the plan's `Steps` section are recorded with the `todo` tool (via
  `ctx.executeTool`); steps marked `- [x]` (or `[DONE:n]`) seed as completed, and
  nested sub-bullets are treated as notes. The list is a merge, not a
  replacement: existing items keep their place and status, a step whose text is
  already there is skipped, and the tool's item cap defers the rest instead of
  dropping anything. The plan's `## Verification` section follows as the **last**
  todo item, summarized on one line (`Verify: …`) — a fenced block contributes its
  commands, not its fence lines. It is not a plan step, so it is ticked in the todo
  list rather than with `set_plan_steps`, and it never counts against the 50-step
  cap. A plan without a `Steps` heading keeps the older rule —
  the shallowest list in the document — so prose bullets in a plan that follows the
  outline never become todos, and its verification bullets are already covered.
  Each seeded item is matched back to its step by text, so ticking a step with
  `set_plan_steps` completes the item too.
- **Goal-aware.** While planning, the injected context restates a pursued
  session goal as one bullet, so the plan is designed against the objective
  instead of beside it. On approval, a goal the goal workflow left as a draft
  (`planning`) is finalized from the plan's own `## Goal` section — falling back
  to the title — through the `goal` tool, with no extra dialog, because approving
  the plan *is* the decision. A session with no goal at all is given the same
  objective, also without asking. An `active` or `achieved` goal is never
  rewritten: a final objective is the user's. No path spends a model turn.
- **Branch-aware.** The enabled flag and the review baseline are custom session
  entries, so `/resume` and `/tree` restore the right mode and keep the
  changed-section markers.

## Tools

| Tool | Active | Purpose |
|---|---|---|
| `enter_plan_mode` | normal mode | Ask to enter plan mode; empty schema, confirmed with `ctx.ui.confirm`. |
| `write_plan` | plan mode | Save the plan: `title` (file-name slug), `content` (full markdown in the documented outline), optional `plan_path` to overwrite a refinement. Returns the absolute path. A plan with more than 50 top-level steps in its `Steps` section is refused, with the cap and the fix named, and nothing is written. |
| `exit_plan_mode` | plan mode | Read the plan file (`plan_path`) and present it for approval. The review also offers **Exit plan mode (discard)**, which leaves plan mode without approving. Refuses a file whose step list is over the cap, before the review screen. |
| `cancel_plan_mode` | plan mode | Leave plan mode without a plan file or a review. Restores write access; records no todo items or goal; keeps any saved plan. Empty schema. |
| `set_plan_steps` | normal mode | Keep an approved plan current: set the checkboxes of the given top-level steps (`updates`, each a 1-based `step` in the order `exit_plan_mode` listed, plus `status`, and `expected` — the step's text, so a reordered plan is refused) to `pending` or `completed` in one write. Only the checkboxes change, and a reopened step drops its `[DONE:n]` marker. The todo item approval seeded from a step is ticked with it: the file is written first and is authoritative, a renamed item is left alone, and a failed todo write is reported in the result. |

### Commands and flags

| Path | Who starts it | Confirmation |
|---|---|---|
| `enter_plan_mode` tool | the model, before a non-trivial task | `ctx.ui.confirm` |
| `/plan` | the user | immediate |
| `/plan <prompt>` | the user, with the task | immediate |
| `/plan list` | the user, browsing the plans directory | immediate |
| `/plan review [path]` | the user, reviewing a plan in the browser | immediate |
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

`/plan review` is the one reserved subcommand. Bare `/plan review` reviews the
plan this session wrote, or, in a later session, the newest plan file in the
plans directory (newest modification time); `/plan review <path>.md` (or a path
with a separator) reviews that plan. A line that merely starts with the word —
`review the auth flow` — is still treated as a planning task, so the subcommand
never swallows one.

### `/skill:init`

`/skill:init` loads the packaged `init` skill. The skill enters plan mode itself
when it is not active, then decides what to do; nothing is written before
approval. Its workflow is:

```text
/skill:init
  └─> plan mode (read-only)
        └─> recon: manifests, docs, CI, tests, existing instructions
        └─> interview: built-in bank, one call of at most 4 questions
              ├─ answered ───────────────> reconcile with evidence
              └─ unavailable/cancelled ──> evidence + assumptions
        └─> draft: new file, exact edits, or an honest no-op
        └─> quality gate
        └─> write_plan ──> exit_plan_mode
                             ├─ not approved ──> refine the same plan
                             └─ approved ──────> write/edit AGENTS.md
                                                 └─ read back + quality checklist
```

The interview comes from a built-in bank in
[`skills/init/references/interview-questions.md`](../../skills/init/references/interview-questions.md):
core questions cover purpose, verification, non-obvious rules, isolation,
completion, sensitive paths, and dependency or network limits, with state-specific
entries for an existing file, an empty repository, and related instruction files.
The first call uses a deterministic four-question set for the repository state;
a second call is allowed only for a material ambiguity. If the tool is inactive,
there is no UI, or the user cancels, the skill records the gaps as assumptions
and continues from repository evidence.

The quality reference is
[`skills/init/references/agents-md-quality.md`](../../skills/init/references/agents-md-quality.md).
An existing `AGENTS.md` is reviewed and updated only after approval, an accurate
file can produce a no-op plan, and an empty repository gets only known facts.
The skill needs the plan extension for its review gate. It also ships with the
package, so load the whole package (`pi -e .`) or install it; loading only
`./extensions/plan` leaves `/skill:init` unavailable.

## Behaviour by mode

The review screen is TUI-only. `exit_plan_mode` opens `PlanViewComponent`: a
scrollable, width-safe view of the plan with approve/refine/keep/exit in the footer.
The body is rendered with Pi's own `Markdown` component and `getMarkdownTheme()`,
so headings, lists, inline code, code blocks, links, and quotes carry the active
theme's colors; task items get the shared `◼` (done) or `◻` (pending) marker,
like the bytefly screen and the question dialog. The footer colors the primary
actions (`a approve & run` in `success`, `r refine` in `accent`).
`a` asks `y/N` in the footer, then ends plan mode, restores write access, and
seeds `todo`; `y` or `Enter` approves and `n`, `q`, or `Esc` goes back to
reading. `r` keeps the plan
mounted and opens an inline editor beneath it (`Enter` submits, an empty buffer
does nothing, `Esc` returns to the plan); `Esc` keeps planning and tells the
model the plan was not approved; `x` leaves plan mode without approving and
keeps the plan file. The dialog path is one editor prompt: `1` approve, `2` full
plan, `3` keep, `4` exit; any other text refines the plan. Dismissing or timing
out the prompt exits without approving. When the plan changed since the previous review
on this branch, a summary line under the title names how many sections changed
and the scroll row appends `· changed` to the current section. Scroll with `↑`/`↓` or `j`/`k`, `space`/`b` or
`PgUp`/`PgDn`, `d`/`u`, `g`/`G`, and the mouse wheel. Press `n`/`p` to jump to
the next or previous heading; the scroll row names the current section when the
plan has more than one. When the plan overflows,
a gauge row above the hints shows the scroll position, the percent, and the
visible line range (the range drops first on a narrow terminal); the gauge comes
from the design system's `gaugeBar` and stays
visible while the refine editor is open, since the body above is still clipped.
Hints are
dropped whole as the terminal narrows, and each footer leads with its safe exit
(`Esc keep plan` in the review, `Esc back to plan` in the inline editor) so
the exit survives even when only one hint fits.

Dialog-capable non-TUI modes (RPC/WeChat) use one editor prompt; a non-action
reply is the refinement, so “select Refine, then type” is gone. A WeChat turn
takes the same dialog path and is answered over WeChat, even though the session
is in TUI mode: the choice comes from `askHuman(ctx, { custom, dialogs, body })`
in `lib/interaction.ts`, not from `ctx.mode`. No plan file is attached; **full
plan** posts the text and asks again.
Without any UI the tools fail with an actionable message instead of deciding for
the user.

Browser review is a local-turn feature: the server binds `127.0.0.1`, so a remote
(WeChat) turn cannot reach it and `/plan review` there refuses with a notice
instead of opening a server nobody can use. The browser's **Approve & run** is
offered only for the review `exit_plan_mode` opens, since only that flow owns
leaving plan mode; `/plan review` stays comment-only.

Aborting the turn closes a browser review. `exit_plan_mode` forwards the call's
abort signal to the review server, so an aborted turn returns "not approved"
and stops listening instead of waiting on a page nobody is watching.

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
✓ Saved plan .pi/plans/2026-10-09-1809-add-rate-limiting.md
```

```
exit_plan_mode submitted a plan
✓ Plan approved
.pi/plans/2026-10-09-1809-add-rate-limiting.md

# Add rate limiting
1. Add a token bucket …

… 12 more lines (ctrl+o to expand)
```

## Security

Plan mode is a **guard rail, not a sandbox**: extensions run with Pi's OS
permissions, so it prevents accidental writes while planning, not a hostile
command. The read-only guarantee is layered:

- **Capability policy.** A tool is allowed only when it is a known structured
  reader or declares the MCP `readOnlyHint`; `write`, `edit`, and unknown
  mutators are denied.
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

## Review screen

<img src="../../assets/plan.png" alt="The terminal plan review: a Plan Review title rule, a notice that one section changed since the last review, the plan body with its headings and ◼/◻ task checkboxes, a scroll gauge naming the current section and the visible line range, and the Esc/a/r/w, scroll, and section-jump hints" width="100%">

`exit_plan_mode` opens this screen on the plan file it just wrote. The body is
Pi's Markdown renderer with the active theme, so headings, lists, code, and
links read as they do in the transcript; the checkboxes in `Steps` use the
shared `◼`/`◻` vocabulary. A plan taller than the terminal scrolls under a gauge
that names the section at the top of the viewport and the line range it shows,
and the footer lists only the keys that apply. `Esc` keeps planning, `a` asks
`y/N` and then approves and runs, `r` refines inline, and `w` opens the browser
review below.

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
  syntax-token colors as `file-browse` (`lib/web/`), follows the system light/dark
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
  Pi** refuse while a composer holds text and put the cursor back in it, and a
  deleted comment is offered back in the header for a few seconds. The page keeps
  no draft of its own — these are the three ways an open comment could disappear.
- **Prints as a document.** Printing uses the light palette whatever the screen
  shows, drops the header, panel, rail, and progress bar, and lets the comments
  stay with the blocks they belong to.
- **Keyboard first.** `j`/`k` move to the next or previous block, `c` comments
  on the current block, `a` approves (the approval flow only), `s` saves, `Esc`
  closes the composer or the sheet and then the review, and `?` opens a shortcut
  sheet; the header's `?` button opens the same sheet. Either dialog traps
  `Tab` and hands focus back to whatever opened it.
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
  documentation, not feedback. The browser keeps no copy of its own.
- **A revision keeps the review.** `write_plan` passes the file it is replacing
  through `carryFeedback`, which re-attaches each comment to the block whose text
  survived the rewrite. A comment whose block is gone moves to the end of the
  file, where the page shows it as unattached, rather than disappearing.
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
| `POST /api/share?token=…` | owner only: mint a reviewer link and its QR |
| `POST /api/share/stop?token=…` | owner only: revoke every reviewer token |

## Shared review

A review is not only the owner's. **Share** in the review header (or `/plan share`)
mints one reviewer token, binds a second listener on the machine's first reachable
IPv4 address, and shows the link with a QR a phone can scan. **Stop sharing**
revokes the token and closes that listener; closing the review does both.

- **Two roles, two tokens.** The owner's token — the one the browser opened with —
  decides: it may comment, save (which returns to the model), approve, cancel, and
  share. A reviewer token may read and comment, and its one write route is
  `POST /api/comment`: `/api/feedback`, `/api/approve`, `/api/cancel`, and
  `/api/share` answer `403`, and the page renders only the name control and
  **Post comments** for it. Anything the reviewer holds is reachable only while the
  share is on.
- **The owner's page is the review's lifetime.** A reviewer's tab opening or
  closing changes nothing; the review ends when the owner saves, approves, or
  closes it, or when the owner's own page goes away. A reviewer's post writes the
  plan and updates every open page, and leaves the review waiting. A page that is
  still open when the review ends is told why — `closed`, or `revoked` when sharing
  was stopped — and keeps the plan readable.
- **Signed comments.** A reviewer names themselves once, on the page; the name is
  kept in that browser, signs each comment, and is what a post replaces — so a
  reviewer can edit or withdraw their own notes and nobody else's, and her second
  post replaces rather than duplicates the first. A name is a
  claim, not an account: whoever holds the link can type it, which is why the
  owner still makes the only decision.
- **One link, one machine.** Sharing opens exactly the address the dialog printed —
  never `0.0.0.0` — and the `Host` allowlist becomes loopback plus that address.
  A machine with no reachable IPv4 address reports why instead of printing a link
  that cannot work. There is no tunnel, no relay, and no cross-machine sync: this
  is the same Wi-Fi.
- **Live.** Every open page follows the stream, so a reviewer's post appears on the
  owner's page without a reload, and a revision saved on disk reaches the
  reviewers. A page with a draft open refuses to repaint and says what arrived
  instead.
- **What a shared link is.** A bearer credential: anyone who has it reads the plan
  and can comment under any name. The dialog says so, `Referrer-Policy:
  no-referrer` keeps a click from leaking it, and **Stop sharing** is the
  revocation. The plan file is the record — a comment arrives as an author-tagged
  marker, so `/resume` and the terminal show the same review the page did.

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

## Non-goals

- **Not a sandbox.** Extensions share Pi's OS permissions.
- **No progress tracker of record.** `todo` owns completion state; the plan
  file only mirrors it (`set_plan_steps`), and plan mode does not read completion
  back out.
- **No auto-execution.** Approval hands control back to the model.

## Pi integration

| Integration point | How |
|---|---|
| Tools | `enter_plan_mode`, `write_plan`, `exit_plan_mode`, and `set_plan_steps` registered with `executionMode: "sequential"`. `enter_plan_mode` is active normally with `readOnlyHint: true`; `write_plan` (`readOnlyHint: false`) and `exit_plan_mode` (`readOnlyHint: true`) are `defaultActive: false`. `set_plan_steps` is active normally (`readOnlyHint: false`, `idempotentHint: true`); the read-only policy default-denies it in plan mode. Each returns typed `details` (`EnterPlanModeDetails`, `WritePlanDetails`, `ExitPlanModeDetails`, `SetPlanStepsDetails`), and `ExitPlanModeDetails` carries the review's `annotations` when a browser approval or save supplied comments; no `outputSchema`/`structuredContent`. |
| Commands and flags | `/plan` (toggle, or enter and send a task), `/plan list` (plans index), `/plan review [path]` (browser review), `/skill:init` (skill-backed `AGENTS.md` bootstrap), `--plan` launch flag, `Ctrl+Alt+P` shortcut. |
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
  is the fallback when that heading is absent), so the outline's prose lists
  never seed the list. The list is whole-list replacement, so the current items
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

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Wiring: tools, command, flag, shortcut, events, context injection. |
| `types.ts` | `PlanModeEntry`, `EnterPlanModeDetails`, `WritePlanDetails`, `ExitPlanModeDetails`, `SetPlanStepsDetails`. |
| `policy.ts` | Plan mode's read-only policy, the shared prompt summary, and the bash-refusal guidance. |
| `git-bash.ts` | `checkReadOnlyGit`: the pure allowlist that restricts `bash` to read-only git commands. |
| `plans.ts` | Plan-file store: slug/stamp naming, directory resolution (repository, active worktree, or agent directory), containment, atomic `write`/`setSteps`/`saveFeedback`, and `read`/`latest`. |
| `todos.ts` | Approval-time todo merge (pure): the last list replayed from the branch, and the merge of the plan's steps into it with the cap respected. |
| `steps.ts` | Plan-document structure (pure): the outline, step extraction and the `Steps`-section scope, heading sections, the plan's own goal (`goalSection`), and the checkbox edit. |
| `format.ts` | Pure result/approval text: the plan preview, the step-cap diagnosis, step labels, the merge summary, and the verification note. |
| `plan-text.ts` | The plan text a review shows and compares: `sanitizePlanText`, the one normalization both sides use, the per-section `sectionDigests`, and `changedSections`. |
| `runtime.ts` | Enabled state, tool gating, persistence (mode and review baseline), control-tool identity, footer status. |
| `tools.ts` | Registration entry: composes the four tool registrations in the order the session sees them. |
| `tools/` | One module per tool (`enter.ts`, `write.ts`, `exit.ts`, `steps.ts`), plus `todo-seed.ts` (the two nested `todo` writes) and `nested.ts` (reading a nested result). |
| `review.ts` | The review gate: one decision from the TUI screen, a dialog, or the browser, the shared browser lifecycle, and the "mark what was shown" baseline rule. |
| `commands.ts` | `/plan` (enter, optional task), `/plan review [path]`, and `/plan share [stop]`. |
| `tui.ts` | `PlanViewComponent` (sectioned Markdown body, changed-section summary and marker, section jump, scroll gauge, the approve `y/N` question, approve/refine/browser/keep). |
| `plan-index.ts` | `/plan list`: the notice text and the docked index screen (title, step progress, age, focused path; Enter reviews). |
| `blocks.ts` | Source-line block model (fence-aware headings, paragraphs, list items, code, quotes, tables, rules, blanks). |
| `feedback.ts` | Comment codec: authored markers, `stripFeedback`, `parseFeedback`, `formatFeedback` (writer-scoped), `displayFeedback`, `carryFeedback`, `resolveAnchor`, `feedbackSummary`, and payload validation. |
| `web.ts` | `createPlanWebReview`: the review session (per-token roles, the change stream, the body cap, settle-after-flush, abort) over the shared bind, writer, and close. |
| `web-router.ts` | Pure request handler: token role, `Host` allowlist, origin, and method checks, then the page, comment, owner-save, approve, cancel, and share routes. |
| `web-page.ts` | The review page shell (header, reading progress, review facts, section outline, shortcut sheet, approve confirmation, share and name dialogs), its data island, and inline CSS. |
| `web-share.ts` | Pure sharing rules: the reachable LAN addresses from an injected snapshot, and the tokenized links built from them. |
| `web-share-session.ts` | The shared listener's lifecycle: its reviewer token, bound address, `ShareState`, and stop/close, injected with the request handler, role map, and frame hooks. |
| `web-client.ts` | The `/client.js` source: state and wiring (comment rail, save/approve/back, keyboard nav, the stream's lifetime) over the three fragments below. |
| `web-comments.ts` | The client's comment half: selection quotes, the composer, authored cards and who may edit them, delete-with-undo. |
| `web-collab.ts` | The client's collaboration half: the share dialog, the reviewer's name, and the island refetch a stream frame triggers. |
| `web-markdown.ts` | The client's document half: `safeHref` and the inline/table/code/list rendering (interpolated into `web-client.ts`). |
| `web-chrome.ts` | The client's chrome half: the state chip, the status line, the header, and reading progress (interpolated into `web-client.ts`). |
| `path-guard.ts` | Recursive path-argument detection for the read-only backstop. |
| [`../../lib/browser.ts`](../../lib/browser.ts) | Cross-platform default-browser opener (shared with `file-browse`). |
| [`../../lib/plan-entry.ts`](../../lib/plan-entry.ts) | Plan-mode entry shared with `goal`: the read-only summary, the consent sentence, and the `pi.events` request `plan` answers by enabling the mode. |
| [`../../lib/shell.ts`](../../lib/shell.ts) | The shell-escape rule the read-only git guard shares with the worktree isolation guard. |
| [`../../lib/highlight.ts`](../../lib/highlight.ts) | First-party escape-first syntax tokenizer (shared with `file-browse`). |
| [`../../lib/qr.ts`](../../lib/qr.ts) | QR matrix, terminal half-blocks, and inline SVG for the share link (shared with `wechat`). |
| [`../../lib/http/`](../../lib/http/) | The bind, `Host` allowlist, header sets, and response kit both browser surfaces serve through. |
| [`../../lib/web/index.ts`](../../lib/web/index.ts) | Shared Bytefly web brand system: tokens, base rules, `tok-*` colors, layout, the bootstrap, the toggle wiring, the shortcut sheet (`keysSheet`, `keysDialogScript`), and shared markup. |
| [`../../lib/http/index.ts`](../../lib/http/index.ts) | Loopback HTTP layer shared with `file-browse`: the page policy and header sets, `ServeResponse`, the request-envelope helpers, bind/respond/close. |
| `../../lib/policy.ts` | Shared read-only capability policy (default-deny + `readOnlyHint`). |
| `../../lib/tui/chrome.ts` | Shared screen header, viewport-row helper, and styled key-hint footer. |
