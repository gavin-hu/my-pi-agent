import { describe, expect, test } from "bun:test";
import { renderStructured } from "./structured.ts";

/** The rendered lines, so a test states a shape rather than one long string. */
function lines(text: string | undefined): string[] {
	return (text ?? "<declined>").split("\n");
}

describe("renderStructured JSON", () => {
	test("renders records as an aligned table", () => {
		const body = JSON.stringify([
			{ id: 1, name: "Ada" },
			{ id: 2, name: "Grace" },
		]);
		expect(lines(renderStructured(body, "application/json"))).toEqual(["id  name", "1   Ada", "2   Grace"]);
	});

	test("gives a ragged list the union of its keys", () => {
		const body = JSON.stringify([
			{ id: 1, name: "Ada" },
			{ id: 2, role: "user" },
		]);
		expect(lines(renderStructured(body, "application/json"))).toEqual(["id  name  role", "1   Ada", "2         user"]);
	});

	test("indents keys and keeps a short list on one line", () => {
		const body = JSON.stringify({ user: { id: 1, name: "Ada", tags: ["a", "b"] } });
		expect(lines(renderStructured(body, "application/json"))).toEqual([
			"user",
			"  id: 1",
			"  name: Ada",
			"  tags: [a, b]",
		]);
	});

	test("lists a long scalar array one item per line", () => {
		const body = JSON.stringify({ items: Array.from({ length: 20 }, (_unused, index) => `item-${index}`) });
		const rendered = lines(renderStructured(body, "application/json"));
		expect(rendered[0]).toBe("items");
		expect(rendered[1]).toBe("  - item-0");
		expect(rendered).toHaveLength(21);
	});

	test("keeps a mixed array nested under a dash", () => {
		expect(lines(renderStructured(JSON.stringify([{ a: 1 }, 2]), "application/json"))).toEqual([
			"-",
			"  a: 1",
			"-",
			"  2",
		]);
	});

	test("compacts a nested value into its table cell", () => {
		const body = JSON.stringify([
			{ id: 1, meta: { x: 1 } },
			{ id: 2, meta: { x: 2 } },
		]);
		expect(lines(renderStructured(body, "application/json"))).toEqual(["id  meta", '1   {"x":1}', '2   {"x":2}']);
	});

	test("clips a nested value that would make a line too long", () => {
		const body = JSON.stringify([{ id: 1, meta: { note: "x".repeat(80) } }]);
		const rendered = renderStructured(body, "application/json") ?? "";
		expect(rendered).toContain("…");
		expect(lines(rendered).every((line) => line.length < 80)).toBe(true);
	});

	test("collapses a string's own line breaks", () => {
		expect(renderStructured(JSON.stringify({ note: "one\ntwo" }), "application/json")).toBe("note: one two");
	});

	test("states empty containers instead of a blank line", () => {
		expect(lines(renderStructured(JSON.stringify({ a: [], b: {}, c: null }), "application/json"))).toEqual([
			"a: []",
			"b: {}",
			"c: null",
		]);
	});

	test("renders a declared scalar body", () => {
		expect(renderStructured("42", "application/json")).toBe("42");
	});

	test("declines a body that is not JSON", () => {
		expect(renderStructured("not json at all", "application/json")).toBeUndefined();
		expect(renderStructured('{"id": 1,}', "application/json")).toBeUndefined();
	});

	test("renders an undeclared body only when it opens like JSON", () => {
		expect(renderStructured('[{"a":1}]', "text/plain")).toBe("a\n1");
		expect(renderStructured("42", "text/plain")).toBeUndefined();
		expect(renderStructured("{not json", "text/plain")).toBeUndefined();
	});
});

describe("renderStructured CSV", () => {
	test("renders comma-separated rows as a table", () => {
		expect(lines(renderStructured("id,name\n1,Ada\n2,Grace\n", "text/csv"))).toEqual([
			"id  name",
			"1   Ada",
			"2   Grace",
		]);
	});

	test("keeps a quoted comma, a doubled quote, and a quoted line break", () => {
		const body = 'name,quote\n"Lovelace, Ada","She said ""hi"""\n"One\nTwo",x\n';
		expect(lines(renderStructured(body, "text/csv"))).toEqual([
			"name           quote",
			'Lovelace, Ada  She said "hi"',
			"One Two        x",
		]);
	});

	test("pads a ragged row instead of shifting the columns after it", () => {
		expect(lines(renderStructured("a,b,c\n1,2\n", "text/csv"))).toEqual(["a  b  c", "1  2"]);
	});

	test("declines a single row", () => {
		expect(renderStructured("a,b,c\n", "text/csv")).toBeUndefined();
	});

	test("declines one column, which is not a table", () => {
		expect(renderStructured("a\nb\n", "text/csv")).toBeUndefined();
	});

	test("declines an unterminated quote", () => {
		expect(renderStructured('a,b\n"x,1\n', "text/csv")).toBeUndefined();
	});

	test("sniffs a uniformly comma-separated plain-text body", () => {
		expect(renderStructured("a,b\n1,2", "text/plain")).toBe("a  b\n1  2");
	});

	test("leaves prose with commas alone", () => {
		expect(renderStructured("Hello, world\nGoodbye, now, then", "text/plain")).toBeUndefined();
	});
});

describe("renderStructured XML", () => {
	test("renders an element, its attribute, and a text child", () => {
		expect(lines(renderStructured('<user id="1"><name>Ada</name></user>', "application/xml"))).toEqual([
			"user",
			"  @id: 1",
			"  name: Ada",
		]);
	});

	test("repeats a sibling in document order", () => {
		expect(lines(renderStructured("<list><item>a</item><item>b</item></list>", "text/xml"))).toEqual([
			"list",
			"  item: a",
			"  item: b",
		]);
	});

	test("reads a text-only element on its own line", () => {
		expect(renderStructured("<p>Hello</p>", "application/xml")).toBe("p: Hello");
	});

	test("skips a declaration and a comment, and keeps CDATA literal", () => {
		const body = '<?xml version="1.0"?><!-- top --><p><![CDATA[a < b]]></p>';
		expect(renderStructured(body, "application/xml")).toBe("p: a < b");
	});

	test("collapses whitespace around text", () => {
		expect(renderStructured("<p>\n  Hello   world\n</p>", "application/xml")).toBe("p: Hello world");
	});

	test("declines unbalanced tags and two roots", () => {
		expect(renderStructured("<a><b></a>", "application/xml")).toBeUndefined();
		expect(renderStructured("<a/><b/>", "application/xml")).toBeUndefined();
		expect(renderStructured("", "application/xml")).toBeUndefined();
	});

	test("sniffs an undeclared document that has a root tag", () => {
		expect(renderStructured("<r><x>1</x></r>", "text/plain")).toBe("r\n  x: 1");
	});

	test("leaves a plain-text angle bracket alone", () => {
		expect(renderStructured("if (a < b) {", "text/plain")).toBeUndefined();
	});
});

describe("renderStructured bounds", () => {
	test("declines a source past the input cap so the raw body can be paged", () => {
		const body = `[{"a":"${"x".repeat(1_048_576)}"}]`;
		expect(renderStructured(body, "application/json")).toBeUndefined();
	});

	test("cuts the rendered text and says where it stopped", () => {
		const body = JSON.stringify(
			Array.from({ length: 4_000 }, (_unused, index) => ({ id: index, name: "y".repeat(60) })),
		);
		const rendered = renderStructured(body, "application/json") ?? "";
		expect(rendered).toContain("the rest was cut");
		expect(rendered.length).toBeLessThan(61_000);
		expect(rendered.length).toBeGreaterThan(50_000);
	});
});
