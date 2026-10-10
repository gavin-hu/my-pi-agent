/**
 * Optional PDF text extraction via the `unpdf` package.
 *
 * `unpdf` bundles a server-friendly build of PDF.js and is loaded lazily, so the
 * extension stays dependency-free unless PDF support is actually used. Callers
 * inject an extractor through `FetchDeps.pdf`.
 */

/** Raised when the optional `unpdf` package is missing or unusable. */
export class PdfUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PdfUnavailableError";
	}
}

export type PdfExtractor = (bytes: Uint8Array) => Promise<string>;

/** Extract plain text from PDF bytes, merging all pages, using `extractor` when given. */
export async function extractPdfText(bytes: Uint8Array, extractor?: PdfExtractor): Promise<string> {
	if (extractor) return extractor(bytes);

	let module: Record<string, unknown>;
	try {
		// A variable specifier keeps `tsc` from resolving the optional package's types.
		const name = "unpdf";
		module = (await import(name)) as Record<string, unknown>;
	} catch {
		throw new PdfUnavailableError("PDF extraction requires the optional 'unpdf' package (npm i unpdf).");
	}

	const candidate = module.extractText ?? (module.default as Record<string, unknown> | undefined)?.extractText;
	if (typeof candidate !== "function") {
		throw new PdfUnavailableError("The installed 'unpdf' package does not export extractText.");
	}

	const result: unknown = await (candidate as (data: Uint8Array, options?: unknown) => Promise<unknown>)(bytes, {
		mergePages: true,
	});
	if (typeof result === "string") return result;
	const text = (result as { text?: unknown } | undefined)?.text;
	return typeof text === "string" ? text : "";
}
