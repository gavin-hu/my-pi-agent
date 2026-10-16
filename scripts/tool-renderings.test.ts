import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { FIXTURES } from "./tool-fixtures.ts";
import { registeredToolNames, renderings } from "./tool-renderings.ts";

/** Columns the sweep renders at: a narrow dock, the gallery width, a wide one. */
const WIDTHS = [46, 80, 120];

describe("fixtures", () => {
	test("every fixture is unique and named", () => {
		const names = FIXTURES.map((fixture) => fixture.name);
		expect(new Set(names).size).toBe(names.length);
		for (const fixture of FIXTURES) {
			expect(fixture.name.length).toBeGreaterThan(0);
			expect(fixture.label.length).toBeGreaterThan(0);
		}
	});

	test("every tool the package registers has a fixture", () => {
		const covered = new Set(FIXTURES.filter((fixture) => fixture.group === "package").map((fixture) => fixture.name));
		const missing = registeredToolNames().filter((name) => !covered.has(name));
		expect(missing).toEqual([]);
	});

	test("no fixture names the real workspace or home", () => {
		const json = JSON.stringify(FIXTURES);
		expect(json).not.toContain("my-pi-agent");
		expect(json).not.toContain(homedir());
	});

	test("a fixture never references itself through an absolute real path", () => {
		for (const fixture of FIXTURES) {
			const args = JSON.stringify(fixture.args ?? {});
			expect(args.startsWith("/Users/")).toBe(false);
		}
	});
});

describe("renderings", () => {
	test("every rendering renders something at the gallery width", () => {
		for (const rendering of renderings()) {
			expect(rendering.lines(80).length, rendering.name).toBeGreaterThan(0);
		}
	});

	test("every line fits the width it was given", () => {
		for (const rendering of renderings()) {
			for (const width of WIDTHS) {
				for (const line of rendering.lines(width)) {
					expect(visibleWidth(line), `${rendering.name} @ ${width}`).toBeLessThanOrEqual(width);
				}
			}
		}
	});

	test("a rendering is stable across calls", () => {
		const [first] = renderings();
		expect(first?.lines(80)).toEqual(first?.lines(80));
	});

	test("a tool block leads with its call and indents the body, with no rail", () => {
		const read = renderings().find((rendering) => rendering.name === "read");
		const lines = (read?.lines(80) ?? []).map(stripTerminalSequences);
		expect(lines[0]?.startsWith("read ")).toBe(true);
		expect(lines[1]?.startsWith("  ")).toBe(true);
		expect(lines[1]?.startsWith("   ")).toBe(false);
	});
});
