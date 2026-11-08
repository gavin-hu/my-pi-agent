# file-read — read a PDF, Word, RTF, or spreadsheet as text

`read_doc` extracts plain text from a local `.pdf`, `.docx`, `.doc`, `.odt`,
`.rtf`, or `.xlsx` file, in slices. Extraction runs inside Pi, so there is no
`pdftotext` to install and no temporary files.

- **You ask; the model calls it** — "read report.pdf and summarise the numbers".
- **Paged**, so a long document arrives in parts instead of flooding the turn.
- **Spreadsheets keep their shape**: one `[Sheet]` heading per worksheet, then
  tab-separated rows.
- **Any local path**, inside the project or not, relative or absolute.

## What you can do

| What you want | What to do |
|---|---|
| Read a document | name it: "read `docs/report.pdf` and summarise it" |
| Continue a long one | ask for the next part; the result named the offset |
| Read a spreadsheet | ask; each sheet arrives under its own heading |
| Read a legacy `.doc` | it works; a `.xls` workbook is converted to `.xlsx` first |
| Stop a slow read | the call reports progress and can be cancelled |
| Turn a format off | set `file-read.formats.<id>: false` |

## Try it

```text
Read docs/quarterly.pdf and list the figures it reports.
```

The result is the document's text, with the offset to continue from if it was
truncated.

## Reference

**The tool.** `read_doc` takes `path`, `startIndex`, and `maxChars`. A relative
path resolves against the effective working directory; an absolute one may sit
anywhere the process can read. The symlink-resolved file is what the parser sees.

**How each format arrives.** PDF, DOCX, DOC, ODT, and RTF become running text; XLSX becomes one `[Sheet]` heading per worksheet and
tab-separated rows, so a cell's position survives. Slicing is by code point, so
CJK and emoji stay well-formed across a page boundary.

**Bounds.** A file over `maxFileBytes` is refused; a parser that outlasts
`extractTimeoutMs` is abandoned and the read fails naming the limit. The default
slice is `maxChars` characters.

**Cost.** Only the format you read loads its parser, so registration costs
nothing at startup.

## Limits

- Text extraction only: layout, images, and charts are not preserved, and a
  scanned PDF with no text layer returns almost nothing.
- The legacy `.xls` format is not read — convert it to `.xlsx` first.
- A password-protected or corrupt file fails with the parser's own message rather
  than a partial read.
- Whole document text is bounded by the per-call budget; a very long document
  needs several reads.

## Settings

| Key | Default | What it does |
|---|---|---|
| `maxFileBytes` | `20971520` | Refuse files larger than this. |
| `maxChars` | `40000` | Default character budget for one slice. |
| `extractTimeoutMs` | `30000` | Per-call extraction deadline. |
| `formats.<id>` | `true` | Enable or disable each of the six formats. |

They live in the `file-read` section of `bytefly.json`
([configuration](../configuration.md#file-read--document-and-spreadsheet-extraction)).
To switch the extension off, toggle `file-read` in `/bytefly`.

## Learn more

- [`file-browse`](../extensions/file-browse.md) — look at the file first.
- [`file-open`](../extensions/file-open.md) — hand it to the OS app instead.
