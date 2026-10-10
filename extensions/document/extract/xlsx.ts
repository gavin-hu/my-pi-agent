/**
 * XLSX text extraction via `gridcraft-cli`.
 *
 * `gridcraft-cli cat` prints one sheet (the active one, or `--sheet NAME`) as an
 * aligned table or, with `--csv`, RFC-4180 CSV. Because `cat` names no sheet and
 * reads only one, the extractor first asks `gridcraft-cli info --json` for the
 * sheet list and used ranges, then reads each non-empty sheet with
 * `cat --sheet NAME --csv` and rebuilds the `[Sheet]` + tab-separated-rows text
 * this tool has always returned. The CLI reads the file itself, so this module
 * never touches the bytes.
 */

import { stripControlChars } from "../../../lib/format.ts";
import type { DocCli, DocFile } from "./cli.ts";

/** One sheet as `gridcraft-cli info --json` reports it. */
export interface SheetInfo {
	name: string;
	/** The sheet's used range, e.g. `A1:D20`; undefined when the sheet is empty. */
	usedRange?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Parse the `sheets` array of `gridcraft-cli info --json`.
 *
 * Returns `[]` for a document with no sheets; throws when the output is not the
 * expected JSON object, so a CLI change fails loudly instead of silently
 * returning no text. Pure.
 */
export function parseSheetList(json: string): SheetInfo[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Error("gridcraft-cli info did not return valid JSON.");
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.sheets)) {
		throw new Error("gridcraft-cli info did not report a sheet list.");
	}
	const sheets: SheetInfo[] = [];
	for (const entry of parsed.sheets) {
		if (!isRecord(entry) || typeof entry.name !== "string") continue;
		const usedRange = typeof entry.usedRange === "string" ? entry.usedRange : undefined;
		sheets.push({ name: entry.name, usedRange });
	}
	return sheets;
}

/**
 * Parse RFC-4180 CSV as `gridcraft-cli cat --csv` writes it: quoted fields,
 * `""` escapes, commas, and LF / CRLF / CR line endings. A trailing newline does
 * not produce an extra row. Pure.
 */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	let started = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					quoted = false;
				}
			} else {
				field += ch;
			}
			continue;
		}
		if (ch === '"') {
			quoted = true;
			started = true;
		} else if (ch === ",") {
			row.push(field);
			field = "";
			started = true;
		} else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && text[i + 1] === "\n") i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
			started = false;
		} else {
			field += ch;
			started = true;
		}
	}
	if (started) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

/** One sheet as the text builder consumes it. */
interface Sheet {
	sheet: string;
	data: unknown[][];
}

function isSheet(value: unknown): value is Sheet {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { sheet?: unknown; data?: unknown };
	return typeof candidate.sheet === "string" && Array.isArray(candidate.data);
}

/**
 * One cell as plain text. Tabs and newlines collapse to spaces so a cell cannot
 * break the row/column layout, and control characters are stripped. Pure.
 */
export function cellToText(value: unknown): string {
	if (value === null || value === undefined) return "";
	return stripControlChars(String(value))
		.replace(/[\t\n\r]+/g, " ")
		.trim();
}

/**
 * Render sheets as plain text: a `[<name>]` heading per non-empty sheet, then
 * tab-separated rows. Trailing empty cells and fully empty rows are dropped, and
 * sheets are separated by a blank line. Pure; returns `""` for anything that is
 * not a sheet array.
 */
export function sheetsToText(value: unknown): string {
	if (!Array.isArray(value)) return "";
	const sections: string[] = [];
	for (const entry of value) {
		if (!isSheet(entry)) continue;
		const rows = entry.data
			.map((row) => {
				if (!Array.isArray(row)) return [] as string[];
				const cells = row.map(cellToText);
				while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
				return cells;
			})
			.filter((row) => row.some((cell) => cell !== ""));
		if (rows.length === 0) continue;
		sections.push(`[${entry.sheet}]\n${rows.map((row) => row.join("\t")).join("\n")}`);
	}
	return sections.join("\n\n");
}

/**
 * Extract plain text from a workbook, one `[Sheet]` section per non-empty
 * worksheet, via `gridcraft-cli info --json` plus one `cat --sheet --csv` per
 * worksheet.
 */
export async function extractXlsxText(file: DocFile, cli: DocCli): Promise<string> {
	const options = { signal: file.signal };
	const info = await cli.run("gridcraft-cli", ["info", file.path, "--json"], options);
	const sections: Sheet[] = [];
	for (const { name, usedRange } of parseSheetList(info)) {
		if (!usedRange) continue;
		const csv = await cli.run("gridcraft-cli", ["cat", file.path, "--sheet", name, "--csv"], options);
		sections.push({ sheet: name, data: parseCsv(csv) });
	}
	return sheetsToText(sections);
}
