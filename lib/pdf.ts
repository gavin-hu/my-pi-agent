/**
 * The optional `unpdf` seam: lazy load, module-shape handling, and text
 * extraction, shared by `web-access` and `document`.
 *
 * `unpdf` bundles a server-friendly build of PDF.js, so it is imported lazily:
 * an extension registers on every session, and a parser should load only when a
 * read actually needs it. `web-access` treats the package as optional and
 * reports {@link pdfGuidance} when it is absent; `document` ships it as a
 * dependency. Both get the same loader, the same merged-pages call, and the same
 * result unwrapping, so a PDF reads the same way through either surface.
 *
 * Value-only: no module state, and no import of `unpdf` until a caller asks.
 */

/** Install command for the optional PDF extractor package. */
const UNPDF_INSTALL = "npm i unpdf";

/** Model-facing guidance when the optional `unpdf` package is absent. */
export function pdfGuidance(): string {
	return `PDF extraction requires the optional 'unpdf' package (${UNPDF_INSTALL}).`;
}

/** Raised when `unpdf` is missing or does not expose `extractText`. */
export class PdfUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PdfUnavailableError";
	}
}

/** Extract merged page text from PDF bytes. */
export type PdfExtractor = (bytes: Uint8Array) => Promise<string>;

/** Pull the merged text out of `unpdf`'s `{ totalPages, text }` result. Pure. */
export function pdfTextFromResult(result: unknown): string {
	if (typeof result === "string") return result;
	const text = (result as { text?: unknown } | undefined)?.text;
	return typeof text === "string" ? text : "";
}

/** The `extractText` function of an imported `unpdf` module, when it exposes one. */
function extractTextOf(module: unknown): ((bytes: Uint8Array, options?: unknown) => Promise<unknown>) | undefined {
	if (typeof module !== "object" || module === null) return undefined;
	const named = (module as { extractText?: unknown }).extractText;
	if (typeof named === "function") return named as (bytes: Uint8Array, options?: unknown) => Promise<unknown>;
	const fallback = (module as { default?: unknown }).default;
	if (typeof fallback !== "object" || fallback === null) return undefined;
	const nested = (fallback as { extractText?: unknown }).extractText;
	if (typeof nested !== "function") return undefined;
	return nested as (bytes: Uint8Array, options?: unknown) => Promise<unknown>;
}

/**
 * Build an extractor from an imported `unpdf` module.
 *
 * `unpdf` exports `extractText` directly; the default-export fallback tolerates
 * a build that wraps it. Anything else is a broken install, reported with the
 * same error the missing-package path uses.
 */
export function pdfExtractorFromModule(module: unknown): PdfExtractor {
	const extractText = extractTextOf(module);
	if (!extractText) throw new PdfUnavailableError("The installed 'unpdf' package does not export extractText.");
	return async (bytes) => pdfTextFromResult(await extractText(bytes, { mergePages: true }));
}

/** Load `unpdf` lazily, or throw {@link PdfUnavailableError} with install guidance. */
export async function loadPdfExtractor(): Promise<PdfExtractor> {
	let module: unknown;
	try {
		module = await import("unpdf");
	} catch {
		throw new PdfUnavailableError(pdfGuidance());
	}
	return pdfExtractorFromModule(module);
}

/** Extract merged page text from PDF bytes, using `extractor` when given. */
export async function extractPdfText(bytes: Uint8Array, extractor?: PdfExtractor): Promise<string> {
	if (extractor) return extractor(bytes);
	const loaded = await loadPdfExtractor();
	return loaded(bytes);
}
