# prompt — ask before you act

`prompt` refines a submitted prompt before the agent starts working on it. On
every eligible submit, the current session model is asked whether the request is
clear; when it is not, you answer a few structured questions, and the agent
receives your original wording plus the confirmed goal and the answers.

```
pi --extension ./extensions/prompt   # load just this extension
pi -e .                              # load the whole @gavin-hu/my-pi-agent package
pi install ./                        # install the package
```

## What it does

- Intercepts each submitted prompt through Pi's `input` event, before the agent
  loop, and replaces it only when it clarifies something.
- Makes one nested clarifier call on the current session model. The model
  returns `clear`, a one-sentence `goal`, and up to `maxQuestions` questions.
- Passes the prompt through unchanged when the request is already clear, when
  there is no UI, or when the model call fails, times out, or returns junk.
- When it is not clear, asks the questions through Pi's own dialogs: a labelled
  choice list with an automatic free-form entry, or a text prompt for an
  open-ended question.
- Confirms the assembled request (the goal plus your answers) before submitting.
- Submits `original prompt + Clarified goal + answered questions` to the agent.

Escape on any dialog cancels the whole refinement and submits your original
prompt. Nothing is ever half-applied.

## Commands

| Command | Description |
|---|---|
| `/prompt` or `/prompt help` | Show usage and the current state. |
| `/prompt refine` or `/prompt refine status` | Report the on/off state and the active limits. |
| `/prompt refine on` | Refine prompts for the rest of this session. |
| `/prompt refine off` | Stop refining for the rest of this session. |

`refine on`/`off` is a session-only override; the config file is the durable
switch and is re-read at `session_start`.

## Behaviour by mode

| Mode | Behaviour |
|---|---|
| `tui` | A cancellable spinner while the clarifier runs, then the built-in dialogs. |
| `rpc` | The dialogs are forwarded through the RPC extension UI protocol; no spinner. |
| `json` / `print` | No UI, so refinement is skipped and the prompt is submitted unchanged. |

`PI_DISABLED_EXTENSIONS=prompt` loads the package without the extension.

## Configuration

Read from `<agent-dir>/prompt.json`, then `<cwd>/.pi/prompt.json` (project wins),
at `session_start`. Missing or malformed files are ignored.

```jsonc
{
  "enabled": true,        // false loads it inert; /prompt refine on re-enables for the session
  "maxQuestions": 3,      // 1-4
  "minLength": 20,        // prompts shorter than this are never refined
  "contextMessages": 2,   // recent user/assistant turns sent as context; 0 sends none
  "confirmGoal": true,    // show the goal confirmation before submitting
  "timeoutMs": 30000      // bound on the clarifier call; 1000-120000
}
```

Numeric keys are clamped to their published bounds; a non-number keeps the
default.

## How a prompt is refined

1. Pi dispatches the `input` event for the submitted text.
2. An eligibility gate decides locally (no model call) whether to continue: the
   extension must be enabled, dialog UI and a model must exist, the agent must
   be idle, the input must not be extension-injected or streaming, and the text
   must be at least `minLength` characters and not start with `/` or `!`.
3. The clarifier runs behind the spinner. It receives the request, prefixed by
   the last `contextMessages` turns rendered as plain text, and must reply with
   a single JSON object:

   ```jsonc
   {
     "clear": false,
     "goal": "one sentence stating the concrete goal",
     "questions": [
       {
         "header": "Auth",              // <= 12 characters
         "question": "Which auth should we use?",
         "options": [                   // 0, or 2-4 entries; empty means free-form
           { "label": "OAuth", "description": "provider OAuth flow" }
         ]
       }
     ]
   }
   ```

4. The reply is parsed defensively: fences are stripped, the first JSON object
   is taken, every string is sanitized to one control-free line, questions and
   options are clamped, and malformed entries are dropped. A `clear` reply, an
   empty question list, or an unparseable reply all pass the prompt through.
5. Each question is asked in order. A choice question shows its labels (with
   descriptions folded in) plus an "Other (type something)" entry; an
   open-ended question, or the "Other" choice, uses a text prompt. Escape
   cancels everything.
6. When `confirmGoal` is set, the goal and the collected answers are shown for
   confirmation.
7. The final text is the original prompt, a `Clarified goal` line, and the
   answered questions:

   ```
   <original prompt>

   Clarified goal: <goal>

   Clarifications:
   - <header>: <question>
     Answer: <answer>
   ```

## Limitations

- The clarifier's token usage is not added to the session totals. Pi exposes a
  read-only session manager to extensions, so there is no way to record it.
- Plan mode cannot be detected (the `plan` extension publishes no event, and Pi
  exposes no way to read another extension's status), so refinement also runs
  inside plan mode. Use `/prompt refine off` there.
- With `contextMessages: 0`, follow-up prompts are judged without conversation
  context and may be questioned when they are actually clear.
- The config file is read once, at `session_start`; editing it needs a reload.
- Only one refinement runs at a time; a prompt submitted while one is open is
  passed through unchanged.

## Non-goals

- No prompt rewriting or a second model call; the agent gets the original words.
- No model-facing tool. The extension only reacts to submitted prompts.
- No coupling to other extensions. Plan mode, `ask-user-question`, and the
  task list are neither read nor driven.

## Pi integration

- **Integration points**: an `input` event handler that returns
  `{ action: "transform", text }` or `{ action: "continue" }`, and the `/prompt`
  command. No tools are registered, so there is no `exposure`, `executionMode`,
  `annotations`, or `outputSchema`.
- **Model call**: `ctx.modelRegistry.complete(ctx.model, ...)` with
  `cacheRetention: "none"`, an `AbortController` for `timeoutMs`, and the TUI
  loader's signal linked to it. The call never rejects out of the handler.
- **State**: nothing is persisted. The session on/off override and the
  in-flight guard live in closures created by the factory; the config comes
  from the two JSON files.
- **Lifecycle**: `session_start` loads the config and clears any override;
  `session_shutdown` releases the busy guard. The factory only registers.

## Design notes

The `input` event is the only hook that runs after submit and before the agent
loop while allowing a different text to be submitted, which is exactly the
shape this feature needs. Pi runs `input` handlers once per `prompt()` and uses
the transform result directly, so there is no re-dispatch loop; the busy guard
is still kept because a provider or UI stall should never overlap with a second
submit.

Pi's host dialogs (`select`, `input`, `confirm`) are used instead of a custom
renderer: they already work in TUI and RPC, they are the built-in visual
language, and the only surface that needs a component is the waiting spinner.
The spinner covers the model call only, because a dialog and a loader cannot
own the editor slot at the same time.

The goal is confirmed together with the answers rather than on its own, because
the clarifier produces its `goal` before it hears the answers; confirming the
raw goal would confirm a statement that ignores the clarifications.

## Files

| File | Responsibility |
|---|---|
| [`index.ts`](./index.ts) | Factory: env guard, runtime, `/prompt` command, and the `input` handler wired to the real host seams. |
| [`config.ts`](./config.ts) | `PromptConfig`, `normalizePromptConfig`, `loadPromptConfig` (reads `prompt.json`). |
| [`schema.ts`](./schema.ts) | `Clarification`/`ClarifyQuestion`/`Answer` types and the defensive `parseClarification`. |
| [`clarifier.ts`](./clarifier.ts) | The clarifier system prompt, the recent-conversation block, the request, and the assembled prompt. |
| [`dialogs.ts`](./dialogs.ts) | `withLoader`, `askQuestions`, and `confirmRequest` over `ctx.ui`. |
| [`refine.ts`](./refine.ts) | `shouldRefine`, `createCompleter`, and the `refinePrompt` orchestration with injected seams. |
| [`runtime.ts`](./runtime.ts) | Per-session config, the on/off override, and the busy guard. |
| [`commands.ts`](./commands.ts) | The `/prompt` subcommand dispatcher. |

## Testing

Every module has a co-located test. The orchestration tests inject `complete`,
`ask`, and `confirm`, so no model, terminal, or session is needed; `config.ts`
uses the shared temp-directory helpers. `extension.test.ts` drives the factory
through `createFakePi` and `fakeCtx` in RPC mode (which takes the direct,
unloaded path) and covers the transform, pass-through, cancellation, and
eligibility cases.

```bash
bun test extensions/prompt
```
