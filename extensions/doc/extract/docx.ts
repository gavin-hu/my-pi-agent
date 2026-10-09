/**
 * Optional DOCX text extraction via the `mammoth` package.
 *
 * `mammoth` reads the OOXML document and returns its raw text, discarding
 * formatting. It is loaded lazily, so the extension stays dependency-free unless
 * a DOCX is actually read. Tests inject an extractor or a loader through the
 * seams below instead of installing the optional package.
 */

/** Raised when the optional `mammoth` package is missing or unusable. */
export class DocxUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DocxUnavailableError";
	}
}

export type DocxExtractor = (bytes: Uint8Array) => Promise<string>;
export type DocxLoader = () => Promise<DocxExtractor>;

let extractorOverride: DocxExtractor | undefined;
let loaderOverride: DocxLoader | undefined;

/** Override the extractor (tests only). Pass undefined to clear. */
export function setDocxExtractorForTests(extractor: DocxExtractor | undefined): void {
	extractorOverride = extractor;
}

/** Override the lazy loader (tests only). Pass undefined to clear. */
export function setDocxLoaderForTests(loader: DocxLoader | undefined): void {
	loaderOverride = loader;
}

async function loadDocxExtractor(): Promise<DocxExtractor> {
	let module: Record<string, unknown>;
	try {
		// A variable specifier keeps `tsc` from resolving the optional package's types.
		const name = "mammoth";
		module = (await import(name)) as Record<string, unknown>;
	} catch {
		throw new DocxUnavailableError("DOCX extraction requires the optional 'mammoth' package (npm i mammoth).");
	}

	const candidate = module.extractRawText ?? (module.default as Record<string, unknown> | undefined)?.extractRawText;
	if (typeof candidate !== "function") {
		throw new DocxUnavailableError("The installed 'mammoth' package does not export extractRawText.");
	}

	return async (bytes) => {
		const result: unknown = await (candidate as (input: { buffer: Buffer }) => Promise<unknown>)({
			buffer: Buffer.from(bytes),
		});
		const value = (result as { value?: unknown } | undefined)?.value;
		return typeof value === "string" ? value : "";
	};
}

/** Extract plain text from DOCX bytes. */
export async function extractDocxText(bytes: Uint8Array): Promise<string> {
	if (extractorOverride) return extractorOverride(bytes);
	const extract = loaderOverride ? await loaderOverride() : await loadDocxExtractor();
	return extract(bytes);
}
