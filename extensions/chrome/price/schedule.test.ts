import { describe, expect, test } from "bun:test";
import { isPeak, parseWindow, peakFormatter } from "./schedule.ts";

/** The DeepSeek peak windows: 09:00-12:00 and 14:00-18:00, Monday to Friday. */
const deepseek = {
	timezone: "Asia/Shanghai",
	windows: [
		{ days: [1, 2, 3, 4, 5], from: 540, to: 720 },
		{ days: [1, 2, 3, 4, 5], from: 840, to: 1080 },
	],
};

/** Epoch milliseconds, built without a clock so the test stays deterministic. */
const utc = (year: number, month: number, day: number, hour: number, minute = 0): number =>
	Date.UTC(year, month, day, hour, minute);

describe("parseWindow", () => {
	test("reads a window, defaulting the days to every day", () => {
		expect(parseWindow({ from: " 09:00 ", to: "12:00" })).toEqual({ days: [1, 2, 3, 4, 5, 6, 7], from: 540, to: 720 });
		expect(parseWindow({ days: [5, 1, 1], from: "22:00", to: "02:00" })).toEqual({ days: [1, 5], from: 1320, to: 120 });
	});

	test("drops a malformed window instead of guessing", () => {
		expect(parseWindow({ from: "9:5", to: "12:00" })).toBeNull();
		expect(parseWindow({ from: "09:60", to: "12:00" })).toBeNull();
		expect(parseWindow({ from: "09:00", to: "09:00" })).toBeNull();
		expect(parseWindow({ from: "24:00", to: "12:00" })).toBeNull();
		expect(parseWindow({ from: 540, to: "12:00" })).toBeNull();
		expect(parseWindow({ days: [8], from: "09:00", to: "12:00" })).toBeNull();
		expect(parseWindow("09:00-12:00")).toBeNull();
		expect(parseWindow(undefined)).toBeNull();
	});
});

describe("isPeak", () => {
	test("matches a weekday window in its own zone", () => {
		const format = peakFormatter("Asia/Shanghai");
		expect(isPeak(deepseek, utc(2026, 0, 5, 3), format)).toBe(true); // Monday 11:00 local
		expect(isPeak(deepseek, utc(2026, 0, 5, 0), format)).toBe(false); // Monday 08:00 local
	});

	test("treats the end of a window as off-peak", () => {
		const format = peakFormatter("Asia/Shanghai");
		expect(isPeak(deepseek, utc(2026, 0, 5, 3, 59), format)).toBe(true); // 11:59 local
		expect(isPeak(deepseek, utc(2026, 0, 5, 4), format)).toBe(false); // 12:00, the midday gap
		expect(isPeak(deepseek, utc(2026, 0, 5, 5), format)).toBe(false); // 13:00
		expect(isPeak(deepseek, utc(2026, 0, 5, 6), format)).toBe(true); // 14:00
		expect(isPeak(deepseek, utc(2026, 0, 5, 10), format)).toBe(false); // 18:00
	});

	test("reads the configured zone, not UTC", () => {
		expect(isPeak(deepseek, utc(2026, 0, 5, 3), peakFormatter("Asia/Shanghai"))).toBe(true);
		expect(isPeak(deepseek, utc(2026, 0, 5, 3), peakFormatter("UTC"))).toBe(false);
	});

	test("excludes a weekend", () => {
		expect(isPeak(deepseek, utc(2026, 0, 3, 3), peakFormatter("Asia/Shanghai"))).toBe(false); // Saturday 11:00
	});

	test("wraps a window past midnight and keeps its opening day", () => {
		const schedule = { timezone: "UTC", windows: [{ days: [1], from: 1320, to: 120 }] };
		const format = peakFormatter("UTC");
		expect(isPeak(schedule, utc(2026, 0, 5, 23), format)).toBe(true); // Monday 23:00
		expect(isPeak(schedule, utc(2026, 0, 6, 1), format)).toBe(true); // Tuesday 01:00, the tail
		expect(isPeak(schedule, utc(2026, 0, 6, 3), format)).toBe(false); // Tuesday 03:00
		expect(isPeak(schedule, utc(2026, 0, 5, 1), format)).toBe(false); // Monday 01:00, Sunday's tail
	});

	test("treats an empty schedule as always peak", () => {
		expect(isPeak({ timezone: "UTC", windows: [] }, utc(2026, 0, 5, 3), peakFormatter("UTC"))).toBe(true);
	});
});
