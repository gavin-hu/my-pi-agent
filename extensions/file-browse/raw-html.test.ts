import { describe, expect, test } from "bun:test";
import {
	closesSuppressed,
	closeHtmlSink,
	createHtmlSink,
	htmlBlockStart,
	sanitizeHtmlBlock,
	sanitizeInlineTag,
} from "./raw-html.ts";

/** Sanitize one block as a complete document, closing whatever it left open. */
function block(source: string, baseDir = ""): string {
	const sink = createHtmlSink();
	return sanitizeHtmlBlock(source, baseDir, sink) + closeHtmlSink(sink);
}

describe("sanitizeHtmlBlock structure", () => {
	test("keeps an allowlisted element and its text", () => {
		expect(block("<details>\n<summary>More</summary>\nplain\n</details>")).toBe(
			"<details>\n<summary>More</summary>\nplain\n</details>",
		);
		expect(block("<details open>")).toBe("<details open></details>");
		expect(block("<div id=top title='A &amp; B'>x</div>")).toBe('<div id="top" title="A &amp; B">x</div>');
	});

	test("drops class and style, which could restyle the page chrome", () => {
		expect(block('<div class="bf-card__head" style="position:fixed">x</div>')).toBe("<div>x</div>");
		expect(block("<span style='color:red'>x</span>")).toBe("<span>x</span>");
	});

	test("drops event handlers and unknown attributes", () => {
		const html = block('<img src="a.png" onerror="alert(1)" onload=alert(2)>');
		expect(html).toBe('<img class="md-img" src="/raw/a.png" alt="" loading="lazy" decoding="async">');
		expect(block('<div onclick="x" data-whatever="y">t</div>')).toBe("<div>t</div>");
	});

	test("re-emits void and self-closing elements", () => {
		expect(block("<br>")).toBe("<br>");
		expect(block("<hr/>")).toBe("<hr>");
		expect(block("<wbr>")).toBe("<wbr>");
	});

	test("balances an unclosed element and drops a stray end tag", () => {
		expect(block("<div><span>x")).toBe("<div><span>x</span></div>");
		expect(block("<div>x</div></div>")).toBe("<div>x</div>");
		expect(block("<div>x</section></div>")).toBe("<div>x</div>");
		expect(block("<details><div>x</details>")).toBe("<details><div>x</div></details>");
	});

	test("drops comments, declarations, and processing instructions", () => {
		expect(block("<!-- hidden -->")).toBe("");
		expect(block("<!DOCTYPE html>")).toBe("");
		expect(block("<?xml version='1.0'?>")).toBe("");
	});

	test("escapes a disallowed element instead of losing it", () => {
		expect(block("<center>x</center>")).toBe("&lt;center&gt;x&lt;/center&gt;");
		expect(block("<custom-tag a=1>")).toBe("&lt;custom-tag a=1&gt;");
	});

	test("escapes malformed markup rather than guessing", () => {
		expect(block('<a href="x"')).toBe('&lt;a href="x"');
		expect(block("1 < 2")).toBe("1 &lt; 2");
		expect(block("<3")).toBe("&lt;3");
	});

	test("keeps preformatted text inert", () => {
		expect(block("<pre><code>a < b & c</code></pre>")).toBe("<pre><code>a &lt; b & c</code></pre>");
	});

	test("lets the browser decode a reference in a text node", () => {
		expect(block("<p>AT&amp;T &copy;</p>")).toBe("<p>AT&amp;T &copy;</p>");
		expect(block("<p>&lt;script&gt;</p>")).toBe("<p>&lt;script&gt;</p>");
	});

	test("lowercases tag and attribute names", () => {
		expect(block("<DETAILS OPEN><SUMMARY>S</SUMMARY></DETAILS>")).toBe("<details open><summary>S</summary></details>");
	});
});

describe("sanitizeHtmlBlock elements and attributes", () => {
	test("drops a suppressed element with its body", () => {
		expect(block("<script>alert(1)</script>")).toBe("");
		expect(block("<style>body{display:none}</style>")).toBe("");
		expect(block('<svg><path d="M0 0"/></svg>')).toBe("");
		expect(block("<iframe src='https://e'>x</iframe>")).toBe("");
		expect(block("<template><b>x</b></template>")).toBe("");
	});

	test("drops the rest of a block for an unclosed suppressed element", () => {
		expect(block("<svg>\n<path d='M0 0'/>")).toBe("");
	});

	test("resolves links and images through the shared URL policy", () => {
		expect(block('<a href="docs/x.md">x</a>', "sub")).toBe('<a href="/view/sub/docs/x.md">x</a>');
		expect(block('<a href="#usage">x</a>')).toBe('<a href="#usage">x</a>');
		expect(block('<a href="https://e">x</a>')).toBe(
			'<a href="https://e" target="_blank" rel="noopener noreferrer">x</a>',
		);
		expect(block('<img src="i.png" alt="pic" width="20" height="10">', "docs")).toBe(
			'<img class="md-img" src="/raw/docs/i.png" alt="pic" width="20" height="10" loading="lazy" decoding="async">',
		);
		expect(block('<img src="i.png" alt="pic" title="t">')).toBe(
			'<img class="md-img" src="/raw/i.png" alt="pic" title="t" loading="lazy" decoding="async">',
		);
	});

	test("degrades an unsafe or external image", () => {
		expect(block('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
		expect(block('<img src="data:image/png;base64,AAA" alt="dot">')).toBe("dot");
		expect(block('<img src="../../secret.png" alt="nope">')).toBe("nope");
		expect(block('<img src="https://e/i.png" alt="badge">')).toBe(
			'<a href="https://e/i.png" target="_blank" rel="noopener noreferrer">badge</a>',
		);
		expect(block('<img src="https://e/i.png">')).toContain(">https://e/i.png</a>");
	});

	test("cannot break out of an attribute value", () => {
		const html = block(`<a href="a.md" title='x" onmouseover="alert(1)'>t</a>`);
		expect(html).toBe('<a title="x&quot; onmouseover=&quot;alert(1)" href="/view/a.md">t</a>');
		expect(html).not.toContain('" onmouseover="');
	});

	test("takes the first duplicate attribute, and decodes entities in values", () => {
		expect(block('<a href="a.md" href="javascript:x">t</a>')).toBe('<a href="/view/a.md">t</a>');
		expect(block('<a href="a&amp;b.md">t</a>')).toBe('<a href="/view/a%26b.md">t</a>');
	});

	test("keeps the table and list attributes it understands", () => {
		expect(block('<td colspan="2" rowspan="3" style="x">c</td>')).toBe('<td colspan="2" rowspan="3">c</td>');
		expect(block('<th scope="col" colspan="x">h</th>')).toBe('<th scope="col">h</th>');
		expect(block('<th scope="evil">h</th>')).toBe("<th>h</th>");
		expect(block('<ol start="3"><li value="7">x</li></ol>')).toBe('<ol start="3"><li value="7">x</li></ol>');
		expect(block('<time datetime="2026-01-01">then</time>')).toBe('<time datetime="2026-01-01">then</time>');
	});
});

describe("sanitizeInlineTag", () => {
	test("accepts phrasing tags and settles leftover opens", () => {
		const stack: string[] = [];
		expect(sanitizeInlineTag("<kbd>Ctrl</kbd>", 0, "", stack)).toEqual({ html: "<kbd>", end: 5 });
		expect(sanitizeInlineTag("<kbd>Ctrl</kbd>", 9, "", stack)).toEqual({ html: "</kbd>", end: 15 });
		expect(stack).toEqual([]);
	});

	test("declines block and unknown tags so the caller escapes them", () => {
		expect(sanitizeInlineTag("<div>", 0, "", [])).toBeUndefined();
		expect(sanitizeInlineTag("<center>", 0, "", [])).toBeUndefined();
		expect(sanitizeInlineTag("<https://e>", 0, "", [])).toBeUndefined();
		expect(sanitizeInlineTag("x", 0, "", [])).toBeUndefined();
	});

	test("drops an inline suppressed element with its body", () => {
		expect(sanitizeInlineTag("a<script>x</script>b", 1, "", [])).toEqual({ html: "", end: 19 });
		expect(sanitizeInlineTag("a<!-- note -->b", 1, "", [])).toEqual({ html: "", end: 14 });
	});

	test("drops an unmatched inline end tag", () => {
		expect(sanitizeInlineTag("</b>", 0, "", [])).toEqual({ html: "", end: 4 });
	});
});

describe("htmlBlockStart", () => {
	test("recognizes allowed blocks, suppressed blocks, and comments", () => {
		expect(htmlBlockStart("<details>")).toEqual({ kind: "html" });
		expect(htmlBlockStart("</details>")).toEqual({ kind: "html" });
		expect(htmlBlockStart("  <table>")).toEqual({ kind: "html" });
		expect(htmlBlockStart("<!-- note -->")).toEqual({ kind: "html" });
		expect(htmlBlockStart("<script>")).toEqual({ kind: "suppressed", name: "script" });
		expect(htmlBlockStart("</svg>")).toEqual({ kind: "suppressed", name: "svg" });
	});

	test("leaves phrasing tags, indented code, and text alone", () => {
		expect(htmlBlockStart("<kbd>Ctrl</kbd>")).toBeUndefined();
		expect(htmlBlockStart("    <details>")).toBeUndefined();
		expect(htmlBlockStart("text <details>")).toBeUndefined();
	});

	test("finds the close of a suppressed element", () => {
		expect(closesSuppressed("</script>", "script")).toBe(true);
		expect(closesSuppressed("</SCRIPT >", "script")).toBe(true);
		expect(closesSuppressed("</style>", "script")).toBe(false);
	});
});

describe("sanitizer invariant", () => {
	const ALLOWED = [
		"a",
		"abbr",
		"article",
		"aside",
		"b",
		"blockquote",
		"br",
		"caption",
		"cite",
		"code",
		"dd",
		"del",
		"details",
		"div",
		"dl",
		"dt",
		"em",
		"figcaption",
		"figure",
		"footer",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"header",
		"hr",
		"i",
		"img",
		"ins",
		"kbd",
		"li",
		"mark",
		"nav",
		"ol",
		"p",
		"pre",
		"q",
		"s",
		"samp",
		"section",
		"small",
		"span",
		"strong",
		"sub",
		"summary",
		"sup",
		"table",
		"tbody",
		"td",
		"tfoot",
		"th",
		"thead",
		"time",
		"tr",
		"u",
		"ul",
		"var",
		"wbr",
	];
	const FRAGMENTS = [
		"<script>",
		"</script>",
		"javascript:",
		"data:",
		'"',
		"'",
		"&",
		"<",
		">",
		"onerror=",
		"style=",
		"class=",
		"<!--",
		"-->",
		"<img src=x onerror=1>",
		"<a href=",
		"</a>",
		"<div>",
		"</div>",
		"`",
		"|",
		"#",
		"\n",
		" ",
		"x",
		"<svg>",
		"</svg>",
		"<details>",
		"</details>",
		"[",
		"]",
		"(",
		")",
		"<kbd>",
		"<td colspan=2>",
	];

	/** A deterministic LCG, so a failure is reproducible from its seed. */
	function random(seed: number): () => number {
		let state = seed >>> 0;
		return () => {
			state = (state * 1664525 + 1013904223) >>> 0;
			return state / 2 ** 32;
		};
	}

	test("every emitted tag is well-formed and carries only allowlisted attributes", () => {
		const next = random(20261020);
		const ALLOWED_ATTRS = new Set([
			"id",
			"title",
			"href",
			"target",
			"rel",
			"open",
			"start",
			"value",
			"colspan",
			"rowspan",
			"scope",
			"datetime",
			"src",
			"alt",
			"width",
			"height",
			"class",
			"loading",
			"decoding",
		]);
		for (let round = 0; round < 250; round++) {
			let source = "";
			const length = 1 + Math.floor(next() * 24);
			for (let part = 0; part < length; part++) {
				source += FRAGMENTS[Math.floor(next() * FRAGMENTS.length)];
			}
			const html = block(source);
			expect(html).not.toMatch(/<script/i);
			expect(html).not.toMatch(/<(style|svg|iframe)/i);
			for (const tag of html.match(/<[^>]*>/g) ?? []) {
				const match = /^<(\/?)([a-z][a-z0-9-]*)((?: [a-z][a-z0-9-]*="[^"]*")*)\s*>$/.exec(tag);
				expect(match).not.toBeNull();
				if (match === null) continue;
				expect(ALLOWED).toContain(match[2]);
				for (const attr of match[3].matchAll(/ ([a-z][a-z0-9-]*)="/g)) {
					expect(ALLOWED_ATTRS).toContain(attr[1]);
				}
				expect(tag).not.toMatch(/(?:href|src)="(?:javascript|data):/i);
				expect(tag).not.toMatch(/^<[a-z][a-z0-9-]* class="(?!md-img")/);
			}
		}
	});
});
