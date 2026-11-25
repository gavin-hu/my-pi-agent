/**
 * The `web_fetch` argument boundary: the two header caps its schema publishes, held by the
 * normalizer as well.
 *
 * Pi refuses a 21st header, or a value past the published length, before `execute` — the
 * parameter schema carries both. `resolveRequest` is also called directly, by the page path and
 * by a programmatic caller, so `normalizeHeaders` keeps the same caps read from the same two
 * constants. The schema's half of that pair is `test/tool-caps.test.ts`; this is the half a
 * caller that bypasses the schema meets.
 *
 * Its own suite rather than two cases in `fetch.test.ts`, which is named in `LONG_SUITES` at its
 * height and may not grow.
 */

import { describe, expect, test } from "bun:test";
import { overLimit } from "../../../lib/format.ts";
import { DEFAULT_FETCH_CONFIG } from "./config.ts";
import { MAX_HEADERS, MAX_HEADER_VALUE, resolveRequest } from "./schema.ts";

const CONFIG = DEFAULT_FETCH_CONFIG;

describe("the header caps", () => {
	test("refuses more headers than the schema allows", () => {
		const many = Object.fromEntries(Array.from({ length: MAX_HEADERS + 1 }, (_, index) => [`X-H${index}`, "v"]));
		expect(() => resolveRequest({ url: "https://a/", headers: many }, CONFIG)).toThrow(
			`at most ${MAX_HEADERS} headers are allowed.`,
		);
	});

	test("refuses a header value past the published length", () => {
		expect(() =>
			resolveRequest({ url: "https://a/", headers: { X: "v".repeat(MAX_HEADER_VALUE + 1) } }, CONFIG),
		).toThrow(overLimit('header "X"', MAX_HEADER_VALUE + 1, MAX_HEADER_VALUE));
	});
});
