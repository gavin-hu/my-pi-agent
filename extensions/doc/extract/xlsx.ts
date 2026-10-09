/**
 * XLSX text extraction via the `read-excel-file` package.
 *
 * `read-excel-file` reads the OOXML workbook and returns every sheet as
 * `[{ sheet, data }]`, with values as `string | number | boolean | Date | null`.
 * It is a normal dependency of this package, so Pi installs it with the
 * package; the loader still imports it lazily so the extension keeps loading if
 * the package is somehow absent. Tests inject an extractor or a loader through
 * the seams below instead of parsing a real workbook.
 */

import { stripControlChars } from "../../../lib/format.ts";

/** Raised when the `read-excel-file` package is missing or unusable. */
export class XlsxUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "XlsxUnavailableError";
	}
}

export type XlsxExtractor = (bytes: Uint8Array) => Promise<string>;
export type XlsxLoader = () => Promise<XlsxExtractor>;

let extractorOverride: XlsxExtractor | undefined;
let loaderOverride: XlsxLoader | undefined;

/** Override the extractor (tests only). Pass undefined to clear. */
export function setXlsxExtractorForTests(extractor: XlsxExtractor | undefined): void {
	extractorOverride = extractor;
}

/** Override the lazy loader (tests only). Pass undefined to clear. */
export function setXlsxLoaderForTests(loader: XlsxLoader | undefined): void {
	loaderOverride = loader;
}

/** One sheet as `read-excel-file` returns it. */
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
 * break the row/column layout, and control characters are stripped. A date at
 * midnight UTC renders as `YYYY-MM-DD`; one with a time keeps the full ISO
 * string. Pure and side-effect free.
 */
export function cellToText(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (value instanceof Date) {
		const iso = value.toISOString();
		return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
	}
	if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
	if (typeof value === "number") return String(value);
	return stripControlChars(String(value))
		.replace(/[\t\n]+/g, " ")
		.trim();
}

/**
 * Render the `read-excel-file` result as plain text: a `[<name>]` heading per
 * non-empty sheet, then tab-separated rows. Trailing empty cells and fully
 * empty rows are dropped, and sheets are separated by a blank line. Pure and
 * side-effect free; returns `""` for anything that is not a sheet array.
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

async function loadXlsxExtractor(): Promise<XlsxExtractor> {
	let module: Record<string, unknown>;
	try {
		// A variable specifier keeps `tsc` from resolving the runtime subpath.
		const name = "read-excel-file/node";
		module = (await import(name)) as Record<string, unknown>;
	} catch {
		throw new XlsxUnavailableError(
			"XLSX extraction requires the 'read-excel-file' package, which Pi installs with this package.",
		);
	}

	const candidate = module.default;
	if (typeof candidate !== "function") {
		throw new XlsxUnavailableError("The installed 'read-excel-file' package does not export a default reader.");
	}

	return async (bytes) => {
		const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
		const result: unknown = await (candidate as (input: unknown) => Promise<unknown>)(input);
		return sheetsToText(result);
	};
}

/** Extract plain text from XLSX bytes, one `[Sheet]` section per worksheet. */
export async function extractXlsxText(bytes: Uint8Array): Promise<string> {
	if (extractorOverride) return extractorOverride(bytes);
	const extract = loaderOverride ? await loaderOverride() : await loadXlsxExtractor();
	return extract(bytes);
}
