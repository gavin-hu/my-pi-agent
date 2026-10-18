import { afterAll, describe, expect, test } from "bun:test";
import { extractDocText } from "./doc.ts";
import { makeDocumentFixture } from "../../../test/helpers/fixtures/document.ts";
import { legacyDocBytes } from "../../../test/helpers/fixtures/documents.ts";

const fixture = makeDocumentFixture();
afterAll(() => fixture.remove());

describe("extractDocText", () => {
	test("extracts the body of a real legacy .doc", async () => {
		const path = fixture.write("legacy.doc", legacyDocBytes());

		const text = await extractDocText({ path });

		expect(text).toContain("Legacy Word fixture.");
		expect(text).toContain("Second paragraph.");
		// The two paragraphs stay separated, so the body story is read, not flattened.
		expect(text).toContain("Legacy Word fixture.\n\nSecond paragraph.");
	});

	test("rejects a file that is neither OLE nor ZIP", async () => {
		const path = fixture.write("bad.doc", "plain text, not a Word file");
		await expect(extractDocText({ path })).rejects.toThrow(/Unable to read this type of file/);
	});
});
