import { describe, expect, test } from "bun:test";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	compactStatus,
	computeGauge,
	contextColor,
	dropStatusDetail,
	formatCost,
	formatCwd,
	formatPercent,
	formatTokens,
	sanitize,
	stripAnsi,
	thinkingColor,
	truncateLabel,
} from "./format.ts";
import { GLYPHS } from "../../lib/ui.ts";

describe("formatTokens", () => {
	test("scales across the thresholds", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(999)).toBe("999");
		expect(formatTokens(1000)).toBe("1.0k");
		expect(formatTokens(12345)).toBe("12k");
		expect(formatTokens(1500000)).toBe("1.5M");
		expect(formatTokens(12000000)).toBe("12M");
	});
});

describe("formatCost", () => {
	test("always renders two decimals", () => {
		expect(formatCost(0.31)).toBe("$0.31");
		expect(formatCost(1)).toBe("$1.00");
		expect(formatCost(12.5)).toBe("$12.50");
	});

	test("keeps the cents for a small nonzero cost", () => {
		expect(formatCost(0.04)).toBe("$0.04");
		expect(formatCost(0)).toBe("$0.00");
	});

	test("never renders a positive sub-cent cost as $0.00", () => {
		expect(formatCost(0.004)).toBe("<$0.01");
	});
});

describe("formatPercent", () => {
	test("rounds and handles unknown", () => {
		expect(formatPercent(62.4)).toBe("62%");
		expect(formatPercent(null)).toBe("?");
	});
});

describe("formatCwd", () => {
	test("shortens a path under home", () => {
		expect(formatCwd("/home/u/repo/project", "/home/u", 0)).toBe("~/repo/project");
		expect(formatCwd("/home/u/repo/project", "/home/u", 1)).toBe("~/project");
		expect(formatCwd("/home/u/repo/project", "/home/u", 2)).toBe("project");
	});

	test("shortens a path outside home", () => {
		expect(formatCwd("/var/log/nginx", "/home/u", 0)).toBe("/var/log/nginx");
		expect(formatCwd("/var/log/nginx", "/home/u", 1)).toBe("…/log/nginx");
		expect(formatCwd("/var/log/nginx", "/home/u", 2)).toBe("nginx");
	});

	test("handles home itself and no home", () => {
		expect(formatCwd("/home/u", "/home/u", 0)).toBe("~");
		expect(formatCwd("/home/u", "/home/u", 1)).toBe("~");
		expect(formatCwd("/tmp/x", undefined, 0)).toBe("/tmp/x");
	});

	test("handles Windows paths", () => {
		expect(formatCwd("C:\\Users\\gavin\\repo\\project", "C:\\Users\\gavin", 0)).toBe("~/repo/project");
		expect(formatCwd("C:\\Users\\gavin\\repo\\project", "C:\\Users\\gavin", 1)).toBe("~/project");
		expect(formatCwd("C:\\Users\\gavin\\repo\\project", "C:\\Users\\gavin", 2)).toBe("project");
		expect(formatCwd("D:\\work\\thing", "C:\\Users\\gavin", 1)).toBe("…/work/thing");
	});
});

describe("computeGauge", () => {
	test("fills proportionally", () => {
		expect(computeGauge(62, 10)).toEqual({ filled: 6, empty: 4 });
		expect(computeGauge(100, 3)).toEqual({ filled: 3, empty: 0 });
		expect(computeGauge(null, 5)).toEqual({ filled: 0, empty: 5 });
		expect(computeGauge(50, 0)).toEqual({ filled: 0, empty: 0 });
	});

	test("floors the fill so it is full only at 100%", () => {
		expect(computeGauge(50, 3)).toEqual({ filled: 1, empty: 2 });
		expect(computeGauge(99, 10)).toEqual({ filled: 9, empty: 1 });
		expect(computeGauge(100, 10)).toEqual({ filled: 10, empty: 0 });
		expect(computeGauge(200, 10)).toEqual({ filled: 10, empty: 0 });
	});

	test("shows one block for any non-zero usage", () => {
		expect(computeGauge(0, 10)).toEqual({ filled: 0, empty: 10 });
		expect(computeGauge(4, 10)).toEqual({ filled: 1, empty: 9 });
	});
});

describe("contextColor", () => {
	test("steps at the thresholds", () => {
		expect(contextColor(null)).toBe("muted");
		expect(contextColor(0)).toBe("muted");
		expect(contextColor(50)).toBe("muted");
		expect(contextColor(70)).toBe("muted");
		expect(contextColor(71)).toBe("warning");
		expect(contextColor(90)).toBe("warning");
		expect(contextColor(91)).toBe("error");
	});
});

describe("thinkingColor", () => {
	test("maps every level to its theme token", () => {
		expect(thinkingColor("off")).toBe("thinkingOff");
		expect(thinkingColor("minimal")).toBe("thinkingMinimal");
		expect(thinkingColor("low")).toBe("thinkingLow");
		expect(thinkingColor("medium")).toBe("thinkingMedium");
		expect(thinkingColor("high")).toBe("thinkingHigh");
		expect(thinkingColor("xhigh")).toBe("thinkingXhigh");
		expect(thinkingColor("max")).toBe("thinkingMax");
	});

	test("falls back to the off token for an unknown runtime level", () => {
		expect(thinkingColor("nonsense" as ThinkingLevel)).toBe("thinkingOff");
	});
});

describe("sanitize", () => {
	test("collapses whitespace and control characters", () => {
		expect(sanitize("a\r\n\tb   c ")).toBe("a b c");
	});
});

describe("stripAnsi", () => {
	test("removes SGR escapes but keeps the text", () => {
		expect(stripAnsi(`\x1b[33m${GLYPHS.plan} plan\x1b[39m`)).toBe(`${GLYPHS.plan} plan`);
	});
});

describe("compactStatus", () => {
	test("keeps only the icon of an icon+label status", () => {
		expect(compactStatus(`${GLYPHS.plan} plan`)).toBe(GLYPHS.plan);
	});

	test("keeps the count of an icon+count badge", () => {
		expect(compactStatus("↺ 2")).toBe("↺2");
		expect(compactStatus("▸ 12")).toBe("▸12");
	});

	test("strips color while compacting", () => {
		expect(compactStatus("\x1b[33m↺ 3\x1b[39m")).toBe("↺3");
	});

	test("does not mistake a numeric label for a count", () => {
		expect(compactStatus(`${GLYPHS.plan} plan · 2024`)).toBe(GLYPHS.plan);
	});
});

describe("dropStatusDetail", () => {
	test("removes a trailing detail but keeps leading styling", () => {
		expect(dropStatusDetail(`${GLYPHS.plan} plan · add-rate-limiting`)).toBe(`${GLYPHS.plan} plan`);
		expect(dropStatusDetail(`\x1b[33m${GLYPHS.plan} plan · add-rate-limiting\x1b[39m`)).toBe(
			`\x1b[33m${GLYPHS.plan} plan\x1b[39m`,
		);
	});

	test("leaves a status without detail untouched", () => {
		expect(dropStatusDetail(`${GLYPHS.plan} plan`)).toBe(`${GLYPHS.plan} plan`);
		expect(dropStatusDetail("↺ 2")).toBe("↺ 2");
	});
});

describe("truncateLabel", () => {
	test("keeps short labels and truncates by display width", () => {
		expect(truncateLabel("main", 10)).toBe("main");
		expect(truncateLabel("feature/long-name", 8)).toBe("feature…");
		expect(truncateLabel("項目項目項目", 5)).toBe("項目…");
	});
});
