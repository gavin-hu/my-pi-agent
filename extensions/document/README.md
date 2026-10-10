# document — read local PDF, DOCX, DOC, ODT, RTF, and XLSX files as text

`document` adds a `read_doc` tool that extracts plain text from a local `.pdf`,
`.docx`, `.doc`, `.odt`, `.rtf`, or `.xlsx` file, paged with `startIndex` /
`maxChars`. Each format is extracted by an external ArtCraft command-line tool
that reads the file itself: `pdfcraft-cli` for PDF, `wordcraft-cli` for the
word-processing formats (DOCX, DOC, ODT, RTF), and `gridcraft-cli` for XLSX.
Reads are confined to the effective working directory with the same
symlink-aware guard the built-in path tools use.

## Quickstart

```bash
pi --extension ./extensions/document   # this extension only
pi -e .                                # the package from this checkout
pi install ./                          # install the package for a user
```

Install the CLI for each format you need. They are optional: the tool loads
without them, and a read that needs a missing one fails with the install
command in the message.

```bash
cargo install --git https://github.com/storytold/pdfcraft pdfcraft-cli         # PDF
cargo install --git https://github.com/storytold/wordcraft wordcraft-cli       # DOCX, DOC, ODT, RTF
cargo install --git https://github.com/storytold/gridcraft gridcraft-cli       # XLSX
```

Release builds are also available from each project's GitHub releases.

Then ask the model to read a document, or call the tool directly:

```jsonc
{ "path": "docs/spec.pdf" }
{ "path": "docs/spec.pdf", "startIndex": 40000, "maxChars": 40000 }
```

## What it does

- Extracts plain text from `.pdf`, `.docx`, `.doc`, `.odt`, `.rtf`, and `.xlsx`
  files for the model to read.
- Pages long documents: when output is truncated, call again with the
  `startIndex` named in the note.
- Slices by code point, so CJK and emoji stay well-formed.
- Reads only inside the effective working directory, resolving symlinks so a
  link cannot escape it.
- Runs each extractor CLI per read; the extension itself depends on no
  extraction package.

## Tool

`read_doc` — `exposure: "direct"`, active by default, read-only, closed-world
(no network).

| Parameter | Type | Meaning |
|---|---|---|
| `path` | string, required, 1–4096 chars | Path to a `.pdf`, `.docx`, `.doc`, `.odt`, `.rtf`, or `.xlsx`, relative to the working directory (or absolute inside it). |
| `startIndex` | integer ≥ 0 | Code-point offset to start from. Defaults to `0`. |
| `maxChars` | integer 200–100000 | Characters to return. Defaults to the configured `maxChars`. |

Result (`details` / `structuredContent`):

| Field | Meaning |
|---|---|
| `path` | The requested path. |
| `format` | The registry id: `"pdf"`, `"docx"`, `"doc"`, `"odt"`, `"rtf"`, or `"xlsx"`. |
| `bytes` | File size. |
| `chars` | Total characters in the extracted text. |
| `startIndex` | Offset this slice started at. |
| `nextIndex` | Offset to request next when `truncated`. |
| `truncated` | Whether more text remains. |
| `text` | The clean slice, without the header or truncation note. |

The model-facing `content` is a header (`Path:`, `Format:`, `Size:`), a blank
line, the slice, and a truncation note when applicable.

Errors are thrown for: a missing or non-file path, a path outside the root, an
unsupported extension (with a targeted hint for legacy `.xls`), a disabled
format, an over-size file, a missing extractor CLI, and a failing extractor. A
missing CLI's error names its `cargo install --git …` command; the extension
never installs anything itself.

## Behaviour by mode

The tool behaves identically in `tui`, RPC, JSON, and print modes; it has no
widgets or status output. `renderCall` / `renderResult` affect only the
interactive transcript (and HTML exports).

The call line carries the path (`~`-shortened, OSC-8 linked when the terminal
supports it) and any paging options. The result line drops the path — it is
already on the call line — and leads with the format and a humanized range:

```
read_doc ~/docs/spec.pdf (from 40k, max 80k)
PDF · 1–40k of 42k chars · more at 40k · ctrl+o
```

Expanded adds a blank line before the preview body, matching the built-in
header/output gap:

```
read_doc ~/docs/spec.pdf
PDF · 1–40k of 42k chars · more at 40k

Chapter 1
This specification defines ...
... (412 more lines)
```

Collapsed rows end with the expand key (`app.tools.expand`) when there is text
to preview. Expanded rows append a sanitized, line-capped preview
(`PREVIEW_LINES` = 20) of the extracted text, with `... (N more lines)` when the
text is longer; a read with no extractable text shows the summary only. Errors
render as a single sanitized `error` line, and a partial (streaming) result as
`Reading...`. Extracted text is sanitized before a theme colour is applied, so
the theme's own ANSI codes stay intact.

## Configuration

`document.json`, loaded from `~/.pi/agent/document.json` then
`<cwd>/.pi/document.json` (project wins), each merged over the defaults and
clamped:

| Key | Default | Clamp | Meaning |
|---|---|---|---|
| `maxFileBytes` | `20971520` (20 MiB) | 1 KiB – 512 MiB | Reject larger files. |
| `maxChars` | `40000` | 200 – 100000 | Default slice size. |
| `formats` | `{ "pdf": true, "docx": true, "doc": true, "odt": true, "rtf": true, "xlsx": true }` | — | Per-format on/off, merged over each registry entry's default; unknown keys are ignored. |

```jsonc
// .pi/document.json
{ "maxChars": 80000, "formats": { "docx": false } }
```

An existing `doc.json` is ignored; rename it to `document.json`.

## Security

- **Local files only.** The tool reads bytes from disk through the extractor
  CLIs and never opens a socket; the CLIs work offline.
- **Confined to the effective root.** Relative paths resolve against
  `resolveEffectiveCwd`; absolute paths are allowed only inside it. Containment
  is symlink-aware (`isInsideReal`), and the real, resolved path is what the CLI
  receives. The extractor subcommands accept no `--root`, so the extension is
  the containment boundary, not the CLI.
- **Size-capped.** Files larger than `maxFileBytes` are rejected before any CLI
  runs.
- **External processes.** Each read spawns the matching CLI with the user's
  privileges. The CLIs read the named file and may write their own preferences
  or logs; the extension passes no other input and installs nothing.
- **Untrusted text.** Extracted document text is treated as untrusted: it is
  returned as model-facing `content` and data. The collapsed transcript draws
  only a sanitized summary; the expanded transcript draws a sanitized,
  line-capped preview (`PREVIEW_LINES`). Control characters are stripped before
  a theme colour is applied, so raw document bytes never reach the terminal.
- **Worktree guard.** Under the `worktree` extension, `read_doc` is in the
  worktree guard's path-tool map, so `blockReadEscapes` / `blockSymlinkEscapes`
  apply to it exactly as to the built-in `read`.

## Extraction

Each extractor builds a plain-text document from the format's CLI invocation(s):

| Format | Command | Output normalization |
|---|---|---|
| PDF | `pdfcraft-cli text <file>` | Every page in reading order; the CLI separates pages with a line containing a form feed (`\u{c}`). `mergePdfPages` joins them with a blank line. No OCR: a scanned or image-only PDF yields little or no text and is reported as `(no extractable text; the document may be scanned or image-only)`. |
| DOCX / DOC / ODT / RTF | `wordcraft-cli text <file>` | The body story only: paragraphs separated by newlines and table cells by tabs. Headers, footers, footnotes, and comments are not included. |
| XLSX | `gridcraft-cli info <file> --json`, then `gridcraft-cli cat <file> --sheet <name> --csv` | `cat` reads one sheet and names none, so the extractor lists sheets and used ranges from `info --json`, then reads each non-empty sheet as RFC-4180 CSV and rebuilds the `[Sheet]` heading plus tab-separated rows. Dates and numbers use the workbook's displayed values; formulas show their computed value. Cell formatting is dropped. |

The tool is pageable across the whole extracted text, so a word-processing
document or workbook is read in the same `startIndex` / `maxChars` way as a PDF.

## Supported formats

| Format | Extensions | Extractor CLI | Enabled by default |
|---|---|---|---|
| PDF | `.pdf` | `pdfcraft-cli` | yes |
| DOCX | `.docx` | `wordcraft-cli` | yes |
| DOC | `.doc` | `wordcraft-cli` | yes |
| ODT | `.odt` | `wordcraft-cli` | yes |
| RTF | `.rtf` | `wordcraft-cli` | yes |
| XLSX | `.xlsx` | `gridcraft-cli` | yes |

## Adding a format

The format table in `formats.ts` is the single source of truth; the handler,
config defaults, and error listing all derive from it.

1. Add the new CLI to `extract/cli.ts` as a `CliName` with its label and
   repository, so the install guidance is complete.
2. Add `extensions/document/extract/<fmt>.ts` exporting a `DocExtractor` that
   calls `cli.run(<name>, […])` and normalizes the output. Keep the parsing in a
   pure, exported helper so it is testable without a process.
3. Add a `DocumentFormat` entry to `FORMATS` and widen the `id` union.
4. Add `extract/<fmt>.test.ts` with a fake `DocCli`, and extend
   `formats.test.ts` / `config.test.ts`.
5. Add a row to the table above.

A format that shares an existing CLI and invocation needs only step 3 (and a
test): `docx` / `doc` / `odt` / `rtf` all reuse `extractWordcraftText`.
`tool.ts`, `paging.ts`, and the config normalizer need no changes.

## Limitations

- The extractor CLIs are external prerequisites. Without the one for a format,
  that format fails with an install hint.
- XLSX extraction spawns one `info` call plus one `cat` call per non-empty
  sheet, because `gridcraft-cli cat` reads a single sheet per invocation.
- No OCR: scanned or image-only PDFs return little or no text.
- PDF and word-processing formatting, tables, and images are not preserved
  (XLSX keeps the row/column shape but drops cell styling and formulas).
- No extraction timeout. `maxFileBytes` bounds the input, but a complex PDF can
  be CPU-heavy and a CLI can be slow; `maxChars` limits the returned slice, not
  peak extraction memory.
- Only one file per call; legacy `.xls` gets a conversion hint.

## Non-goals

- PPTX, EPUB, and plain text (the registry makes new formats additive; plain
  text is the built-in `read`).
- OCR of scanned documents.
- Remote URLs (use `web_fetch`).
- `file-browser` preview integration.
- Writing, summarizing, or converting documents.

## Pi integration

| Aspect | Contract |
|---|---|
| Registration | `document(pi)` in `index.ts` calls `registerDocTool(pi)`, which builds a `DocCli` over `pi.exec` and registers `read_doc`. The factory only registers. |
| Tool | `read_doc`, `exposure: "direct"`, `defaultActive: true`, default (`parallel`) execution, `annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }`, TypeBox `parameters` and `outputSchema`, and `renderCall`/`renderResult` (reuse `context.lastComponent`; read `context.cwd` and `context.isError`). |
| State | None persisted. Per-result state lives in the tool-result `details` / `structuredContent`; the renderer reads only that. |
| Lifecycle | No `session_start` / `session_shutdown` hooks: each read spawns short-lived CLIs and holds no long-lived resources. |
| Host seams | `pi.exec` (wrapped by `createExecRunner`), `resolveEffectiveCwd` (`lib/env.ts`), `isInsideReal` / `realPathOfNearest` (`lib/path.ts`), `loadConfigFile` (`lib/config.ts`), `stripControlChars` / `sanitize` / `formatTokens` (`lib/format.ts`), `SEPARATORS` (`lib/ui.ts`). |
| Config | `document.json` via `loadConfigFile` (`~/.pi/agent`, `<cwd>/.pi`). |

## Design notes

A separate tool rather than an overload of the built-in `read`: the worktree
extension owns the built-in path tools and re-registers them, so overloading
`read` would fight that machinery. A table-driven registry keeps future formats
additive, and delegating extraction to the ArtCraft CLIs means the extension
ships no document parser and benefits from each tool's own fidelity work.
The four word-processing formats share one extractor because `wordcraft-cli text`
prints the same body text for each.

**Missing-CLI detection is a probe, not a guess.** `pi.exec` resolves a missing
binary as `{ code: 1, stderr: "" }` rather than throwing, which is
indistinguishable from a crash. `createDocCli` treats a non-zero exit with a
stderr message as a real failure, and re-checks a silent failure with
`<cli> --version`: a failed probe becomes `CliUnavailableError` with the install
command, and a passing probe is a plain non-zero exit. The probe runs only on
failure, so the common path is a single spawn.

**The XLSX format is rebuilt, not passed through.** `gridcraft-cli cat` prints
one sheet and no sheet name, which would silently drop every other worksheet.
The extractor asks `info --json` for the sheet list and used ranges, skips empty
sheets, and reassembles `[Sheet]` + tab rows so `read_doc`'s model-facing format
is stable across extractor changes.

The renderer is unchanged and reuses `context.lastComponent` (`Text.setText`),
binding the expand hint to `app.tools.expand`. Path shortening lives in
`render.ts` (not `lib/`): `lib/` helpers are for two or more extensions, and the
built-in-style `~`/boundary rule here is document-only. The result line
deliberately omits the path: Pi stacks the call and result lines in one row, so
repeating it would be pure duplication.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory; registers the tool. |
| `formats.ts` | `DocumentFormat`, the `FORMATS` registry, `FormatId`, `detectFormat`, `supportedExtensions`, `unsupportedHint`. |
| `tool.ts` | The tool definition, handler, path guard, and renderer wiring. Re-exports `TOOL_NAME`. |
| `render.ts` | Theme-aware transcript formatting: call/result lines, `~` + OSC-8 path, expand hint, sanitized preview, `Text` reuse. |
| `schema.ts` | `TOOL_NAME`, `DocParams`, `DocOutput`, limits, result type. |
| `config.ts` | `DocConfig`, registry-derived defaults, `normalizeConfig`, `loadConfig`, `isFormatEnabled`. |
| `paging.ts` | `formatDoc`: code-point slicing and header/truncation formatting; `summarizeDoc`: the theme-free transcript summary. |
| `extract/cli.ts` | The process seam: `CliName`, `RunCli` / `DocCli`, `createExecRunner` / `createDocCli`, `CliUnavailableError`, `cliGuidance`, `DocFile` / `DocExtractor`. |
| `extract/pdf.ts` | `pdfcraft-cli text` extractor and `mergePdfPages`. |
| `extract/wordcraft.ts` | `wordcraft-cli text` extractor (DOCX, DOC, ODT, RTF) and `stripTrailingNewline`. |
| `extract/xlsx.ts` | `gridcraft-cli info` + `cat` extractor, `parseSheetList`, `parseCsv`, `cellToText`, `sheetsToText`. |

## Testing

```bash
bun test extensions/document
```

Tests inject a fake `DocCli` and fake `pi.exec`, so they run without the
extractor CLIs and without network. `test/helpers/fixtures/document.ts` provides
the scratch root and an escape symlink.
