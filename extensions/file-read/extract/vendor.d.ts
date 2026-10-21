/**
 * Ambient types for the two extraction packages that ship no declarations.
 *
 * `word-extractor` is CommonJS (`export =`), as is `rtf-parser`; both are
 * declared here with only the surface the document extractors use. Kept in a
 * `.d.ts` so the runtime imports stay untyped-free and `tsc` can check callers.
 */

declare module "word-extractor" {
	interface WordDocument {
		/** The main body story as plain text. */
		getBody(): string;
	}
	class WordExtractor {
		/** Read a `.doc` (OLE) or `.docx` (ZIP) file from a path or buffer. */
		extract(source: string | Buffer): Promise<WordDocument>;
	}
	export = WordExtractor;
}

declare module "rtf-parser" {
	interface RtfNode {
		/** Set on text spans. */
		value?: string;
		/** Set on paragraphs/groups; absent on text spans. */
		content?: RtfNode[];
	}
	interface RtfDocument {
		content: RtfNode[];
	}
	type RtfCallback = (error: Error | null, document: RtfDocument) => void;
	interface RtfParser {
		(callback: RtfCallback): NodeJS.WritableStream;
		string(input: string, callback: RtfCallback): void;
		stream(input: NodeJS.ReadableStream, callback: RtfCallback): void;
	}
	const parse: RtfParser;
	export = parse;
}
