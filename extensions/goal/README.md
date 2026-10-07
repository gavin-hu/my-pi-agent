# goal — a persistent session objective for Pi

A single high-level objective for the session, kept visible and restated before
every turn. The goal is the *what*; the [`todo`](../todo/) list is the *how*.

```
pi --extension ./extensions/goal    # load just this extension
pi -e .                             # load the whole @gavin-hu/my-pi-agent package
pi install ./                       # install the package
```

## What it does

- Registers one model-callable tool, `goal`, that records the session
  objective. Send the complete objective every call; an empty objective clears
  it.
- Tracks `status`: `active` while the goal is being pursued, `achieved` when it
  is done.
- Shows a persistent glyph rail above the editor whenever a goal exists, using
  the same header + indent + glyph grammar as the [`todo`](../todo/) widget:

  ```
  Goal · active
    ◎ Refactor the parser to support streaming input and ship it with tests
  ```

  Once achieved it collapses to one dim line by default, and the reminder
  stops:

  ```
  ✓ Goal achieved · Refactor the parser to support streaming input and ship it …
  ```

- Restates an **active** goal to the model before each turn (an invisible
  `[SESSION GOAL]` message), so it stays on task across long tool sequences.
- Stores tool-set goals in tool-result `details` and command-set goals as a `goal` session entry, so either way the goal follows the active session branch and survives `/resume` and `/tree` — abandoned branches never leak into the current goal.

## Tool

| Field | Value |
|---|---|
| `name` | `goal` |
| `objective` | The complete objective, one line. Pass `""` to clear. |
| `status` | `active` (default) or `achieved`. |

Validation (a violation returns an error result and leaves the goal unchanged):
a known `status`, and an objective of at most 2000 characters.

Before those checks, the objective is normalized to a single terminal-safe
line: control characters (including `ESC`) become spaces and any whitespace run
(newlines, tabs, repeated spaces) collapses to one space. This keeps the widget
to one logical line and stops model text from injecting terminal sequences.

## Command

| Command | What it does |
|---|---|
| `/goal` | Show the current goal (or report that none is set). |
| `/goal <text>` | Set the goal to `<text>` and mark it active. |
| `/goal done` (or `/goal achieved`) | Mark the current goal achieved. |
| `/goal clear` | Clear the goal. |

## Behaviour by mode

The tool works in every mode. The persistent widget requires interactive
(`tui`) mode; the reminder and the `/goal` command work everywhere. Achieved
goals keep their place in the transcript but collapse to a single line in the
widget by default, and they are no longer restated to the model.

## Configuration

The widget presentation is configurable from `~/.pi/agent/goal.json` and
`<cwd>/.pi/goal.json` (project values override global):

| Key | Default | Meaning |
|---|---|---|
| `maxRows` | `3` | Total widget rows, including the header (clamped 2–6). |
| `achieved` | `"collapse"` | How an achieved goal renders: `collapse` (one dim line), `block` (the full rail), or `hide`. |

Malformed files and invalid values are ignored, and goal behavior never depends
on config.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: wire the runtime, tool, command, reminder, and session events. |
| `types.ts` | `Goal`, `GoalStatus`, `GoalDetails`. |
| `schema.ts` | TypeBox parameters and pure validation/normalization. |
| `state.ts` | Branch reconstruction (pure). |
| `format.ts` | Model-facing and terminal text plus the `◎` / `✓` symbols and the rail vocabulary (pure). |
| `config.ts` | Widget config load/validation (`goal.json`). |
| `tui.ts` | The persistent goal widget and the transcript result rail. |
| `runtime.ts` | Session-scoped state and widget synchronization. |
| `tools.ts` | `goal` tool registration and rendering. |
| `commands.ts` | `/goal`. |
