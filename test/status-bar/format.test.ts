import { describe, expect, test } from "bun:test";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	compactStatus,
	computeGauge,
	contextColor,
	formatCost,
	formatCwd,
	formatPercent,
	formatTokens,
	sanitize,
	stripAnsi,
	thinkingColor,
	truncateLabel,
} from "../../extensions/status-bar/format.ts";

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
	test("two decimals, one when compact", () => {
		expect(formatCost(0.31)).toBe("$0.31");
		expect(formatCost(0.31, true)).toBe("$0.3");
		expect(formatCost(1)).toBe("$1.00");
	});

	test("keeps the cents for a small nonzero cost when compact", () => {
		expect(formatCost(0.04, true)).toBe("$0.04");
		expect(formatCost(0, true)).toBe("$0.00");
	});

	test("never renders a positive sub-cent cost as $0.00", () => {
		expect(formatCost(0.004)).toBe("<$0.01");
		expect(formatCost(0.004, true)).toBe("<$0.01");
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
});

describe("contextColor", () => {
	test("steps at the thresholds", () => {
		expect(contextColor(null)).toBe("muted");
		expect(contextColor(50)).toBe("success");
		expect(contextColor(70)).toBe("success");
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
		expect(stripAnsi("\x1b[33m≡ plan\x1b[39m")).toBe("≡ plan");
	});
});

describe("compactStatus", () => {
	test("keeps only the icon of an icon+label status", () => {
		expect(compactStatus("≡ plan")).toBe("≡");
	});

	test("keeps the count of an icon+count badge", () => {
		expect(compactStatus("↺ 2")).toBe("↺2");
		expect(compactStatus("▸ 12")).toBe("▸12");
	});

	test("strips color while compacting", () => {
		expect(compactStatus("\x1b[33m↺ 3\x1b[39m")).toBe("↺3");
	});

	test("does not mistake a numeric label for a count", () => {
		expect(compactStatus("≡ plan · 2024")).toBe("≡");
	});
});

describe("truncateLabel", () => {
	test("keeps short labels and truncates by display width", () => {
		expect(truncateLabel("main", 10)).toBe("main");
		expect(truncateLabel("feature/long-name", 8)).toBe("feature…");
		expect(truncateLabel("項目項目項目", 5)).toBe("項目…");
	});
});
