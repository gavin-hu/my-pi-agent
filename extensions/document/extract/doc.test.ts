import { afterAll, describe, expect, test } from "bun:test";
import { extractDocText } from "./doc.ts";
import { makeDocumentFixture } from "../../../test/helpers/fixtures/document.ts";

const fixture = makeDocumentFixture();
afterAll(() => fixture.remove());

describe("extractDocText", () => {
	test("rejects a file that is neither OLE nor ZIP", async () => {
		const path = fixture.write("bad.doc", "plain text, not a Word file");
		await expect(extractDocText({ path })).rejects.toThrow(/Unable to read this type of file/);
	});
});
