# doc — read local PDF, DOCX, and XLSX files as text

`doc` adds a `read_doc` tool that extracts plain text from a local `.pdf`,
`.docx`, or `.xlsx` file, paged with `startIndex` / `maxChars`. PDF extraction
uses the optional `unpdf` package, DOCX the optional `mammoth` package, and XLSX
the `read-excel-file` package, which Pi installs with this package. The
extractors are loaded lazily, so the extension still loads when one is missing.
Reads are confined to the effective working directory with the same
symlink-aware guard the built-in path tools use.

## Quickstart

```bash
pi --extension ./extensions/doc   # this extension only
pi -e .                           # the package from this checkout
pi install ./                     # install the package for a user
```

Then ask the model to read a document, or call the tool directly:

```jsonc
{ "path": "docs/spec.pdf" }
{ "path": "docs/spec.pdf", "startIndex": 40000, "maxChars": 40000 }
```

PDF and DOCX extraction are optional. Install the package for the format you
need; a missing one produces an error naming the command. XLSX needs no extra
step: `read-excel-file` is a dependency Pi installs with this package.

```bash
npm i unpdf     # PDF
npm i mammoth   # DOCX
```

## What it does

- Extracts plain text from `.pdf`, `.docx`, and `.xlsx` files for the model to read.
- Pages long documents: when output is truncated, call again with the
  `startIndex` named in the note.
- Slices by code point, so CJK and emoji stay well-formed.
- Reads only inside the effective working directory, resolving symlinks so a
  link cannot escape it.
- Loads its extractor packages on demand; the extension loads without them.

## Tool

`read_doc` — `exposure: "direct"`, active by default, read-only, closed-world
(no network).

| Parameter | Type | Meaning |
|---|---|---|
| `path` | string, required, 1–4096 chars | Path to a `.pdf`, `.docx`, or `.xlsx`, relative to the working directory (or absolute inside it). |
| `startIndex` | integer ≥ 0 | Code-point offset to start from. Defaults to `0`. |
| `maxChars` | integer 200–100000 | Characters to return. Defaults to the configured `maxChars`. |

Result (`details` / `structuredContent`):

| Field | Meaning |
|---|---|
| `path` | The requested path. |
| `format` | The registry id: `"pdf"`, `"docx"`, or `"xlsx"`. |
| `bytes` | File size. |
| `chars` | Total characters in the extracted text. |
| `startIndex` | Offset this slice started at. |
| `nextIndex` | Offset to request next when `truncated`. |
| `truncated` | Whether more text remains. |
| `text` | The clean slice, without the header or truncation note. |

The model-facing `content` is a header (`Path:`, `Format:`, `Size:`), a blank
line, the slice, and a truncation note when applicable.

Errors are thrown for: a missing or non-file path, a path outside the root, an
unsupported extension (with a targeted hint for legacy `.doc` and `.xls`), a
disabled format, an over-size file, and a missing extractor package. If
`read-excel-file` is missing, the error tells the model to ask the user with
`ask_user_question` and gives the install command; the extension never installs
a package itself.

## Configuration

`doc.json`, loaded from `~/.pi/agent/doc.json` then `<cwd>/.pi/doc.json`
(project wins), each merged over the defaults and clamped:

| Key | Default | Clamp | Meaning |
|---|---|---|---|
| `maxFileBytes` | `20971520` (20 MiB) | 1 KiB – 512 MiB | Reject larger files. |
| `maxChars` | `40000` | 200 – 100000 | Default slice size. |
| `formats` | `{ "pdf": true, "docx": true, "xlsx": true }` | — | Per-format on/off, merged over each registry entry's default; unknown keys are ignored. |

```jsonc
// .pi/doc.json
{ "maxChars": 80000, "formats": { "docx": false } }
```

## Security

- **Local files only, no network.** The tool reads bytes from disk and never
  opens a socket.
- **Confined to the effective root.** Relative paths resolve against
  `resolveEffectiveCwd`; absolute paths are allowed only inside it. Containment
  is symlink-aware (`isInsideReal`), so a symlink pointing outside the root is
  refused. Under the `worktree` extension, `read_doc` is also in the worktree
  guard's path-tool map, so `blockReadEscapes` / `blockSymlinkEscapes` apply to
  it exactly as to the built-in `read`.
- **Size-capped.** Files larger than `maxFileBytes` are rejected before reading.
- **Untrusted text.** Extracted document text is treated as untrusted: it is
  returned as model-facing `content` and data. The collapsed transcript draws
  only a sanitized summary; the expanded transcript draws a sanitized,
  line-capped preview (`PREVIEW_LINES`). Control characters are stripped before
  a theme colour is applied, so raw document bytes never reach the terminal.

## Extraction

PDF text comes from `unpdf` (`extractText(bytes, { mergePages: true })`); DOCX
text comes from `mammoth` (`extractRawText({ buffer })`); XLSX text comes from
`read-excel-file` (its default export reads every sheet). PDF and DOCX return
plain, unformatted text: tables, images, styles, and layout are dropped. XLSX
keeps the table shape: each worksheet becomes a `[Sheet]` heading followed by
tab-separated rows, with dates as ISO strings; cell formatting and formulas are
dropped (a formula shows its cached value). A scanned or image-only PDF yields
little or no text and is reported as
`(no extractable text; the document may be scanned or image-only)`.

## Supported formats

| Format | Extensions | Package | Enabled by default |
|---|---|---|---|
| PDF | `.pdf` | `unpdf` | yes |
| DOCX | `.docx` | `mammoth` | yes |
| XLSX | `.xlsx` | `read-excel-file` | yes |

## Adding a format

The format table in `formats.ts` is the single source of truth; the handler,
config defaults, and error listing all derive from it.

1. Add `extensions/doc/extract/<fmt>.ts` with a lazy import, a typed
   `<Fmt>UnavailableError`, and extractor/loader test seams (mirror
   `extract/pdf.ts`).
2. Add a `DocumentFormat` entry to `FORMATS` and widen the `id` union.
3. If it needs a package, declare it in `package.json`: a required runtime
   dependency goes in `dependencies` (Pi installs it with the package, as XLSX
   does), while an optional one goes in `peerDependencies` (`"*"`) plus
   `peerDependenciesMeta` (optional), as `unpdf` and `mammoth` do.
4. Add `extract/<fmt>.test.ts` and extend `formats.test.ts` / `config.test.ts`.
5. Add a row to the table above.

`tool.ts`, `paging.ts`, and the config normalizer need no changes; add optional
`DocParams` fields only if the format needs per-call options.

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

## Limitations

- No OCR: scanned or image-only PDFs return little or no text.
- Formatting, tables, and images are not preserved.
- No decompression or extraction timeout. `maxFileBytes` bounds the compressed
  input, but a DOCX or XLSX is a zip that can expand much larger, and complex
  PDFs can be CPU-heavy; none of `unpdf`, `mammoth`, or `read-excel-file`
  offers cancellation. `maxChars` limits the returned slice, not peak
  extraction memory.
- XLSX drops cell formatting and styles, reads each formula's cached value, and
  covers only `.xlsx` (legacy `.xls` gets a conversion hint).
- Only one file per call.

## Non-goals

- PPTX, EPUB, RTF, ODT, and plain text (the registry makes new formats
  additive; plain text is the built-in `read`).
- OCR of scanned documents.
- Remote URLs (use `web_fetch`).
- `file-browser` preview integration.
- Writing, summarizing, or converting documents.

## Pi integration

| Aspect | Contract |
|---|---|
| Registration | `doc(pi)` in `index.ts` calls `registerDocTool(pi)`, which registers `read_doc`. The factory only registers. |
| Tool | `read_doc`, `exposure: "direct"`, `defaultActive: true`, default (`parallel`) execution, `annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }`, TypeBox `parameters` and `outputSchema`, and `renderCall`/`renderResult` (reuse `context.lastComponent`; read `context.cwd` and `context.isError`). |
| State | None persisted. Per-result state lives in the tool-result `details` / `structuredContent`; the renderer reads only that. |
| Lifecycle | No `session_start` / `session_shutdown` hooks: the tool opens no resources, and extractor packages load lazily per call. |
| Host seams | `resolveEffectiveCwd` (`lib/env.ts`), `isInsideReal` / `realPathOfNearest` (`lib/path.ts`), `loadConfigFile` (`lib/config.ts`), `stripControlChars` / `sanitize` / `formatTokens` (`lib/format.ts`), `SEPARATORS` (`lib/ui.ts`). |
| Config | `doc.json` via `loadConfigFile` (`~/.pi/agent`, `<cwd>/.pi`). |

## Design notes

A separate tool rather than an overload of the built-in `read`: the worktree
extension owns the built-in path tools and re-registers them, so overloading
`read` would fight that machinery. A table-driven registry keeps the future
PPTX/EPUB work additive. The lazy extractors intentionally mirror
`web-access/fetch/pdf.ts` rather than sharing it, because extensions cannot
import each other and the test-seam pattern needs module-level state that
`lib/` forbids.

The renderer reuses `context.lastComponent` (`Text.setText`) and binds the
expand hint to `app.tools.expand`. It builds that hint locally rather than with
the host `keyHint`, which colours through the global theme instead of the theme
passed to the renderer, so the renderer stays testable and works in non-TUI
modes. Path shortening lives in `render.ts` (not `lib/`): `lib/` helpers are for
two or more extensions, and the built-in-style `~`/boundary rule here is
doc-only.

The result line deliberately omits the path: Pi stacks the call and result lines
in one row, so repeating it would be pure duplication.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory; registers the tool. |
| `formats.ts` | `DocumentFormat`, the `FORMATS` registry, `FormatId`, `detectFormat`, `supportedExtensions`, `unsupportedHint`. |
| `tool.ts` | The tool definition, handler, path guard, and renderer wiring. Re-exports `TOOL_NAME`. |
| `render.ts` | Theme-aware transcript formatting: call/result lines, `~` + OSC-8 path, expand hint, sanitized preview, `Text` reuse. |
| `schema.ts` | `TOOL_NAME`, `DocParams`, `DocOutput`, limits, result type. |
| `config.ts` | `DocConfig`, registry-derived defaults, `normalizeConfig`, `loadConfig`, `isFormatEnabled`. |
| `paging.ts` | `formatDoc`: code-point slicing and header/truncation formatting; `summarizeDoc`: the theme-free transcript summary (uppercase format, humanized range). |
| `extract/pdf.ts` | Lazy `unpdf` extractor, `PdfUnavailableError`, test seams. |
| `extract/docx.ts` | Lazy `mammoth` extractor, `DocxUnavailableError`, test seams. |
| `extract/xlsx.ts` | Lazy `read-excel-file` extractor, `XlsxUnavailableError`, `sheetsToText` / `cellToText`, test seams. |

## Testing

```bash
bun test extensions/doc
```

Tests inject extractors through the seams, so they run without `unpdf` or
`mammoth` and without network. `test/helpers/fixtures/doc.ts` provides the
scratch root and an escape symlink.
