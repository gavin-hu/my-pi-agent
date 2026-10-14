# doctor — report whether each extension has what it needs

Every extension in this package can stop working without saying so: an extractor
CLI that is not installed, an optional package that was never added, a config
file with a typo, a runtime the extension cannot reach. `doctor` knows the answer
because each extension declares its runtime prerequisites in
`lib/requirements.ts`, and it reports what is missing — on demand and, when an
enabled extension cannot work at all, once at session start.

```bash
pi --extension ./extensions/doctor   # load just this extension
pi -e .                             # load the whole @gavin-hu/my-pi-agent package
pi install ./                       # install the package
```

## What it does

- Probes every declared extension and reports each check as `ok`, `missing`,
  `degraded`, or `info`.
- Names the file and the parse error when a config file exists but is not valid
  JSON — today those files are silently ignored by `readJson`, so a typo reads
  as "unset".
- Distinguishes "cannot work" from "reduced capability": only a missing *hard*
  requirement warns at session start, and `degraded` findings stay in the report.
- Respects `PI_DISABLED_EXTENSIONS`: a disabled extension is reported as disabled
  and is never probed.
- Never changes anything, and never installs anything.

## Commands

| Command | Effect |
|---|---|
| `/doctor` | Probe everything and show the report. In the TUI this opens a docked list screen. |
| `/doctor <extension>` | Report one extension, including the checks that passed. |
| `/doctor refresh` | Ignore the findings cached earlier in this session and probe again. |

The TUI screen lists one row per extension with a severity glyph and shows the
focused extension's findings underneath. `Enter` switches between problems only
and every check, `r` re-probes, `Esc` closes. While a re-probe is in flight the
hint shows `refreshing…` and a second `r` is ignored, so probes cannot stack.

## Tool

| Tool | Contract |
|---|---|
| `run_doctor` | `{ extension?, refresh? }`. Read-only (`readOnlyHint: true`), `exposure: "direct"`, active by default. Returns the report as text plus a typed `structuredContent` report. |

## What is checked

| Extension | Hard requirement | Optional / degraded |
|---|---|---|
| worktree | `git` | `.worktreeinclude` symlinks need symlink support |
| rewind | `git` | — |
| document | — | — |
| subagent | a runnable nested `pi` | project-local agents need a trusted project |
| plan | — | `git` for project-local `.pi/plans`; an interactive UI |
| memory | — | `git` for the project-scope root |
| file-browser | — | `git` for the branch chip; the browser opener is best-effort |
| web-access | — | `unpdf` |
| wechat | — | `wechat/credentials.json` (not logged in) |
| job | — | Windows has no `EXIT` trap; `ps` is POSIX-only |
| todo, goal | — | their config files |
| bytefly | — | TUI only for the footer and turn rule; the picker's project scope needs a trusted project |
| ask-user-question | — | needs an interactive UI |

Every extension that reads a config file also gets the malformed-JSON check.

## Behaviour by mode

The probes run in every mode; only the presentation differs. In the TUI `/doctor`
opens the list screen. In RPC, JSON, and print modes it prints the same report
through `ctx.ui.notify`, and the proactive warning is skipped when there is no
UI. `run_doctor` returns the same report as text and structured data everywhere.

## Configuration

Read from `~/.pi/agent/doctor.json` and `<cwd>/.pi/doctor.json`; project values
override global ones.

```json
{
  "proactive": true,
  "timeoutMs": 2000,
  "skip": ["wechat"]
}
```

| Key | Default | Meaning |
|---|---|---|
| `proactive` | `true` | Probe the extensions with hard requirements at session start and warn once when something is missing. |
| `timeoutMs` | `2000` | Per-probe timeout for one spawned command, clamped to 100–30000. |
| `skip` | `[]` | Extension names to leave out of every report. |

## Limitations

- `doctor` can only check what is declared. A new extension with no
  `REQUIREMENTS` entry is invisible to it — `test/structure.test.ts` fails on
  exactly that, which is why the table cannot rot quietly.
- The disabled check reads `PI_DISABLED_EXTENSIONS` through `lib/env.ts`; it does
  not read Pi's own `settings.json` disable list, so an extension disabled only
  there may still be probed.
- A probe proves a binary runs, not that it works: a `git` that crashes on a
  specific repository is still `ok`.
- Config scope is checked for `<agent-dir>/<file>.json` and `<cwd>/.pi/<file>.json`
  only; a `jobs.json` `registryDir` override is not followed.

## Non-goals

- No auto-fix. `doctor` reports the install command; it never runs it.
- No aggregation of runtime failures: a tool that errored earlier in the session
  is not a prerequisite problem, and `doctor` does not pretend to know about it.
- No status chip. The report is on demand plus one warning, not a permanent
  footer.

## Pi integration

| Contract | Detail |
|---|---|
| Registration | The default export registers one read-only tool and one command; no flags. |
| Lifecycle | `session_start` loads `doctor.json`, points the runtime at the session cwd, and probes the extensions with hard requirements when `proactive` is on; an idempotent `session_shutdown` drops the cache. |
| Seams | `createDoctorRuntime(pi)` adapts `pi.exec` into the probe seam; the factory takes `{ runtime }` so tests inject fake results. |
| State | Session-scoped in memory only. Findings are cached for the session and never written to the session or a file. |
| Policy | `run_doctor` declares `readOnlyHint: true`, which is what the shared default-deny plan-mode policy in `lib/policy.ts` reads to allow it. |

## Design notes

- **Declarations live in `lib/`, probes live in the extension, presentation is a
  third layer.** An extension cannot import another extension's modules, so the
  only legal home for a shared prerequisite table is `lib/requirements.ts`. When
  another extension needs the same answer (a picker readiness column, say), it
  imports the same table rather than re-deriving it.
- **The install hint has one home.** `document` and `web-access` format their
  tool errors from the same entries `doctor` prints, so a user reads the same
  command whether a tool failed or the report named it.
- **Quiet by default at startup.** Only `missing` findings warn, only for enabled
  extensions, only with a UI, and only once per session. `degraded` findings —
  including a malformed config — wait in `/doctor`, because a session that nags
  about an optional package is worse than one that never mentions it.
- **Probe the real thing.** `subagent`'s requirement resolves through the same
  `getPiInvocation` the extension uses (moved to `lib/pi-invocation.ts`) instead
  of re-guessing whether a `pi` binary exists.
- **The table is data.** No I/O, no host access, no module state: every probe
  dependency arrives as a seam, so `probeExtension` is testable with no process
  and `lib/` stays value-only.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: env guard, config load, session lifecycle, proactive warning. |
| `runtime.ts` | Host seams, the session cache, and the two probe modes. |
| `commands.ts` | The `/doctor` command and its TUI wiring. |
| `tools.ts` | The `run_doctor` tool and its renderers. |
| `schema.ts` | Tool parameters and the structured output schema. |
| `config.ts` | `DEFAULT_CONFIG`, `normalizeConfig`, `loadConfig`. |
| `format.ts` | Pure report text, rows, glyphs, and the warning sentence. |
| `tui.ts` | The docked list screen with its detail pane. |

## Testing

`test/helpers/fixtures/doctor.ts` boots the extension over fake seams, so no test
spawns a binary or imports an optional package: probe behaviour is covered in
`lib/requirements.test.ts`, wiring and the proactive warning in
`extensions/doctor/extension.test.ts`, and rendering in
`extensions/doctor/format.test.ts` and `tui.test.ts`.
