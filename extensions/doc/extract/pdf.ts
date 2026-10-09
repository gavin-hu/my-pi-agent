/**
 * Optional PDF text extraction via the `unpdf` package.
 *
 * `unpdf` bundles a server-friendly build of PDF.js and is loaded lazily, so the
 * extension stays dependency-free unless a PDF is actually read. Tests inject an
 * extractor or a loader through the seams below instead of installing the
 * optional package.
 */

/** Raised when the optional `unpdf` package is missing or unusable. */
export class PdfUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PdfUnavailableError";
	}
}

export type PdfExtractor = (bytes: Uint8Array) => Promise<string>;
export type PdfLoader = () => Promise<PdfExtractor>;

let extractorOverride: PdfExtractor | undefined;
let loaderOverride: PdfLoader | undefined;

/** Override the extractor (tests only). Pass undefined to clear. */
export function setPdfExtractorForTests(extractor: PdfExtractor | undefined): void {
	extractorOverride = extractor;
}

/** Override the lazy loader (tests only). Pass undefined to clear. */
export function setPdfLoaderForTests(loader: PdfLoader | undefined): void {
	loaderOverride = loader;
}

async function loadPdfExtractor(): Promise<PdfExtractor> {
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

	return async (bytes) => {
		const result: unknown = await (candidate as (data: Uint8Array, options?: unknown) => Promise<unknown>)(bytes, {
			mergePages: true,
		});
		if (typeof result === "string") return result;
		const text = (result as { text?: unknown } | undefined)?.text;
		return typeof text === "string" ? text : "";
	};
}

/** Extract plain text from PDF bytes, merging all pages. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
	if (extractorOverride) return extractorOverride(bytes);
	const extract = loaderOverride ? await loaderOverride() : await loadPdfExtractor();
	return extract(bytes);
}
