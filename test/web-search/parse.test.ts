import { describe, expect, test } from "bun:test";
import { decodeEntities, isChallengePage, parseDuckDuckGoHtml, resolveResultUrl, toPlainText } from "../../extensions/web-search/parse.ts";

const FIXTURE = `
<html><body>
  <div class="result result--ad result--ad--small">
    <a rel="nofollow" class="result__a" href="https://ads.example/click">Buy now</a>
    <a class="result__snippet" href="https://ads.example/click">Advert snippet</a>
  </div>
  <div class="result results_links results_links_deep web-result">
    <h2 class="result__title"><a rel="nofollow" class="result__a" href="https://example.com/page">Example &amp; Co &#x27;quoted&#x27;</a></h2>
    <a class="result__snippet" href="https://example.com/page">A <b>bold</b> snippet with &quot;quotes&quot;.</a>
  </div>
  <div class="result results_links">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2F%3Fa%3D1%26b%3D2&amp;rut=abc">Redirect Result</a>
    <a class="result__snippet" href="https://example.org/">Redirect snippet</a>
  </div>
  <div class="result results_links">
    <a rel="nofollow" class="result__a" href="https://example.net/no-snippet">No snippet here</a>
  </div>
  <div class="result results_links">
    <a rel="nofollow" class="result__a" href="https://example.com/page">Duplicate of first</a>
    <a class="result__snippet">duplicate snippet</a>
  </div>
  <div class="result results_links">
    <a rel="nofollow" class="result__a" href="https://zh.wikipedia.org/wiki/%E5%B9%BF%E5%B7%9E%E5%B8%82">广州 &amp; 早茶</a>
    <a class="result__snippet">老广的 <b>早茶</b> 文化，一盅两件。</a>
  </div>
</body></html>
`;

describe("decodeEntities / toPlainText", () => {
	test("decodes named and numeric entities", () => {
		expect(decodeEntities("A &amp; B &quot;c&quot; &#39;d&#39; &#x2764;")).toBe("A & B \"c\" 'd' ❤");
	});

	test("leaves unknown entities alone", () => {
		expect(decodeEntities("&notareal; &amp;")).toBe("&notareal; &");
	});

	test("strips tags and collapses whitespace", () => {
		expect(toPlainText(" <b>Hello</b>\n   <i>world</i> ")).toBe("Hello world");
	});
});

describe("resolveResultUrl", () => {
	test("keeps an absolute https url", () => {
		expect(resolveResultUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
	});

	test("unwraps the duckduckgo uddg redirect", () => {
		expect(resolveResultUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2F%3Fa%3D1%26b%3D2&rut=x")).toBe(
			"https://example.org/?a=1&b=2",
		);
	});

	test("rejects non-http schemes and unusable redirects", () => {
		expect(resolveResultUrl("javascript:alert(1)")).toBeUndefined();
		expect(resolveResultUrl("//duckduckgo.com/l/?rut=no-target")).toBeUndefined();
	});
});

describe("parseDuckDuckGoHtml", () => {
	test("returns organic results, skips ads, resolves redirects, de-duplicates", () => {
		const results = parseDuckDuckGoHtml(FIXTURE, 10);
		expect(results.map((r) => r.url)).toEqual([
			"https://example.com/page",
			"https://example.org/?a=1&b=2",
			"https://example.net/no-snippet",
			"https://zh.wikipedia.org/wiki/%E5%B9%BF%E5%B7%9E%E5%B8%82",
		]);
		expect(results[0].title).toBe("Example & Co 'quoted'");
		expect(results[0].snippet).toBe('A bold snippet with "quotes".');
		expect(results[1].title).toBe("Redirect Result");
		expect(results[2].snippet).toBe("");
	});

	test("preserves CJK title and snippet", () => {
		const cjk = parseDuckDuckGoHtml(FIXTURE, 10).at(-1);
		expect(cjk?.title).toBe("广州 & 早茶");
		expect(cjk?.snippet).toBe("老广的 早茶 文化，一盅两件。");
	});

	test("honours the result limit", () => {
		expect(parseDuckDuckGoHtml(FIXTURE, 2)).toHaveLength(2);
	});

	test("returns an empty array for a page without result blocks", () => {
		expect(parseDuckDuckGoHtml("<html><body>nothing</body></html>", 10)).toEqual([]);
	});
});

describe("isChallengePage", () => {
	test("detects the anti-bot challenge", () => {
		expect(isChallengePage('<form id="challenge-form">')).toBe(true);
		expect(isChallengePage('<div class="anomaly-modal">')).toBe(true);
	});

	test("does not flag a normal results page", () => {
		expect(isChallengePage(FIXTURE)).toBe(false);
	});
});
