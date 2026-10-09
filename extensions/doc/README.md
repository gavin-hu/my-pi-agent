# doc — read local PDF and DOCX files as text

`doc` adds a `read_doc` tool that extracts plain text from a local `.pdf` or
`.docx` file, paged with `startIndex` / `maxChars`. PDF extraction uses the
optional `unpdf` package and DOCX the optional `mammoth` package; both are
loaded lazily, so the extension has no required dependencies. Reads are confined
to the effective working directory with the same symlink-aware guard the
built-in path tools use.

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
need; a missing one produces an error naming the command:

```bash
npm i unpdf     # PDF
npm i mammoth   # DOCX
```

## What it does

- Extracts plain text from `.pdf` and `.docx` files for the model to read.
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
| `path` | string, required, 1–4096 chars | Path to a `.pdf` or `.docx`, relative to the working directory (or absolute inside it). |
| `startIndex` | integer ≥ 0 | Code-point offset to start from. Defaults to `0`. |
| `maxChars` | integer 200–100000 | Characters to return. Defaults to the configured `maxChars`. |

Result (`details` / `structuredContent`):

| Field | Meaning |
|---|---|
| `path` | The requested path. |
| `format` | The registry id: `"pdf"` or `"docx"`. |
| `bytes` | File size. |
| `chars` | Total characters in the extracted text. |
| `startIndex` | Offset this slice started at. |
| `nextIndex` | Offset to request next when `truncated`. |
| `truncated` | Whether more text remains. |
| `text` | The clean slice, without the header or truncation note. |

The model-facing `content` is a header (`Path:`, `Format:`, `Size:`), a blank
line, the slice, and a truncation note when applicable.

Errors are thrown for: a missing or non-file path, a path outside the root, an
unsupported extension (with a targeted hint for legacy `.doc`), a disabled
format, an over-size file, and a missing extractor package.

## Configuration

`doc.json`, loaded from `~/.pi/agent/doc.json` then `<cwd>/.pi/doc.json`
(project wins), each merged over the defaults and clamped:

| Key | Default | Clamp | Meaning |
|---|---|---|---|
| `maxFileBytes` | `20971520` (20 MiB) | 1 KiB – 512 MiB | Reject larger files. |
| `maxChars` | `40000` | 200 – 100000 | Default slice size. |
| `formats` | `{ "pdf": true, "docx": true }` | — | Per-format on/off, merged over each registry entry's default; unknown keys are ignored. |

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
  returned as model-facing `content` and data, and the transcript renderer draws
  only a sanitized summary (path, format, character count), never the raw text.

## Extraction

PDF text comes from `unpdf` (`extractText(bytes, { mergePages: true })`); DOCX
text comes from `mammoth` (`extractRawText({ buffer })`). Both return plain,
unformatted text: tables, images, styles, and layout are dropped. A scanned or
image-only PDF yields little or no text and is reported as
`(no extractable text; possibly a scanned/image-only PDF)`.

## Supported formats

| Format | Extensions | Package | Enabled by default |
|---|---|---|---|
| PDF | `.pdf` | `unpdf` | yes |
| DOCX | `.docx` | `mammoth` | yes |

## Adding a format

The format table in `formats.ts` is the single source of truth; the handler,
config defaults, and error listing all derive from it.

1. Add `extensions/doc/extract/<fmt>.ts` with a lazy import, a typed
   `<Fmt>UnavailableError`, and extractor/loader test seams (mirror
   `extract/pdf.ts`).
2. Add a `DocumentFormat` entry to `FORMATS` and widen the `id` union.
3. If it needs a package, add it to `peerDependencies` (`"*"`) and
   `peerDependenciesMeta` (optional) in `package.json`.
4. Add `extract/<fmt>.test.ts` and extend `formats.test.ts` / `config.test.ts`.
5. Add a row to the table above.

`tool.ts`, `paging.ts`, and the config normalizer need no changes; add optional
`DocParams` fields only if the format needs per-call options.

## Behaviour by mode

The tool behaves identically in `tui`, RPC, JSON, and print modes; it has no
widgets or status output. `renderCall` / `renderResult` affect only the
interactive transcript (and HTML exports).

## Limitations

- No OCR: scanned or image-only PDFs return little or no text.
- Formatting, tables, and images are not preserved.
- No decompression or extraction timeout. `maxFileBytes` bounds the compressed
  input, but a DOCX is a zip that can expand much larger, and complex PDFs can
  be CPU-heavy; neither `unpdf` nor `mammoth` offers cancellation. `maxChars`
  limits the returned slice, not peak extraction memory.
- Only one file per call.

## Non-goals

- XLSX, PPTX, EPUB, RTF, ODT, and plain text (the registry makes new formats
  additive; plain text is the built-in `read`).
- OCR of scanned documents.
- Remote URLs (use `web_fetch`).
- `file-browser` preview integration.
- Writing, summarizing, or converting documents.

## Pi integration

| Aspect | Contract |
|---|---|
| Registration | `doc(pi)` in `index.ts` calls `registerDocTool(pi)`, which registers `read_doc`. The factory only registers. |
| Tool | `read_doc`, `exposure: "direct"`, `defaultActive: true`, default (`parallel`) execution, `annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }`, TypeBox `parameters` and `outputSchema`, and `renderCall`/`renderResult`. |
| State | None persisted. Per-result state lives in the tool-result `details` / `structuredContent`; the renderer reads only that. |
| Lifecycle | No `session_start` / `session_shutdown` hooks: the tool opens no resources, and extractor packages load lazily per call. |
| Host seams | `resolveEffectiveCwd` (`lib/env.ts`), `isInsideReal` / `realPathOfNearest` (`lib/path.ts`), `loadConfigFile` (`lib/config.ts`), `stripControlChars` (`lib/format.ts`). |
| Config | `doc.json` via `loadConfigFile` (`~/.pi/agent`, `<cwd>/.pi`). |

## Design notes

A separate tool rather than an overload of the built-in `read`: the worktree
extension owns the built-in path tools and re-registers them, so overloading
`read` would fight that machinery. A table-driven registry keeps the future
XLSX/PPTX/EPUB work additive. The lazy extractors intentionally mirror
`web-access/fetch/pdf.ts` rather than sharing it, because extensions cannot
import each other and the test-seam pattern needs module-level state that
`lib/` forbids.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory; registers the tool. |
| `formats.ts` | `DocumentFormat`, the `FORMATS` registry, `FormatId`, `detectFormat`, `supportedExtensions`, `unsupportedHint`. |
| `tool.ts` | `TOOL_NAME`, the tool definition, handler, path guard, and renderers. |
| `schema.ts` | `DocParams`, `DocOutput`, limits, result type. |
| `config.ts` | `DocConfig`, registry-derived defaults, `normalizeConfig`, `loadConfig`, `isFormatEnabled`. |
| `paging.ts` | `formatDoc`: code-point slicing and header/truncation formatting. |
| `extract/pdf.ts` | Lazy `unpdf` extractor, `PdfUnavailableError`, test seams. |
| `extract/docx.ts` | Lazy `mammoth` extractor, `DocxUnavailableError`, test seams. |

## Testing

```bash
bun test extensions/doc
```

Tests inject extractors through the seams, so they run without `unpdf` or
`mammoth` and without network. `test/helpers/fixtures/doc.ts` provides the
scratch root and an escape symlink.
