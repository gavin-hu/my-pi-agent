/**
 * XLSX text extraction via the `exceljs` package.
 *
 * `exceljs` reads the workbook in process; every worksheet becomes a `[Sheet]`
 * heading followed by tab-separated rows. Cells use their displayed text, so
 * dates and numbers read as formatted and formulas show their computed value.
 * Cell styling, merged ranges, and images are dropped. The pure helpers
 * (`cellToText`, `sheetsToText`) are tested directly.
 */

import { stripControlChars } from "../../../lib/format.ts";
import { readFormatBytes, type FormatExtractor } from "./file.ts";

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

/** Extract text from a workbook, one `[Sheet]` section per non-empty worksheet. */
export const extractXlsxText: FormatExtractor = async (file) => {
	const bytes = await readFormatBytes(file);
	const { Workbook } = await import("exceljs");
	const workbook = new Workbook();
	// `readFormatBytes` copies into a fresh `Uint8Array`, so its buffer is exactly
	// the file bytes; narrow it for exceljs, which types `load` as ArrayBuffer.
	const { buffer } = bytes;
	if (!(buffer instanceof ArrayBuffer)) {
		throw new Error("XLSX extraction requires an ArrayBuffer-backed file.");
	}
	await workbook.xlsx.load(buffer);
	file.signal?.throwIfAborted();

	const sheets: Sheet[] = [];
	for (const worksheet of workbook.worksheets) {
		const data: unknown[][] = [];
		const columns = typeof worksheet.columnCount === "number" ? worksheet.columnCount : 0;
		worksheet.eachRow({ includeEmpty: true }, (row) => {
			const cells: unknown[] = [];
			for (let column = 1; column <= columns; column++) cells.push(row.getCell(column).text);
			data.push(cells);
		});
		sheets.push({ sheet: worksheet.name, data });
	}
	return sheetsToText(sheets);
};
