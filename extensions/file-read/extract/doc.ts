/**
 * Legacy DOC text extraction via the `word-extractor` package.
 *
 * `word-extractor` detects the classic OLE compound format and returns the body
 * story. It also reads `.docx`, but that path is left to `mammoth`; this module
 * is only wired to the `.doc` extension.
 */

import { normalizeBodyText, type FormatExtractor } from "./file.ts";

/** Extract the body text from a legacy OLE `.doc` file. */
export const extractDocText: FormatExtractor = async (file) => {
	file.signal?.throwIfAborted();
	const module = await import("word-extractor");
	const extractor = new module.default();
	const document = await extractor.extract(file.path);
	file.signal?.throwIfAborted();
	return normalizeBodyText(document.getBody());
};
