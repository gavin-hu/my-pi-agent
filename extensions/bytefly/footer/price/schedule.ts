/**
 * Peak / off-peak evaluation for a priced record.
 *
 * A window is stated in a configured IANA zone, because the tariff a provider
 * publishes is stated in its own local time. `isPeak` takes the formatter as an
 * argument: building one is the expensive part, so a pricer builds it once and
 * reuses it across a branch, keeping this module pure and cheap to call.
 */

import { asRecord } from "../../../../lib/config.ts";
import type { PeakSchedule, PeakWindow } from "./types.ts";

const TIME_OF_DAY = /^(\d{1,2}):(\d{2})$/;
/** Every ISO weekday; the meaning of an omitted `days`. */
const ALL_DAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

/** The `en-US` short weekday names `peakFormatter` can produce. */
const WEEKDAYS: Readonly<Record<string, number>> = {
	Mon: 1,
	Tue: 2,
	Wed: 3,
	Thu: 4,
	Fri: 5,
	Sat: 6,
	Sun: 7,
};

/**
 * Weekday numbers for a window.
 *
 * Omitted or empty means every day. A non-empty list is filtered to valid
 * weekdays; a list yielding none means the window itself is malformed, so it is
 * dropped rather than silently widened to the whole week.
 */
function parseDays(raw: unknown): readonly number[] | null {
	if (raw === undefined) return ALL_DAYS;
	if (!Array.isArray(raw)) return null;
	if (raw.length === 0) return ALL_DAYS;
	const days = new Set<number>();
	for (const value of raw) {
		if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 7) continue;
		days.add(value);
	}
	if (days.size === 0) return null;
	return [...days].sort((a, b) => a - b);
}

/** Minutes since midnight for a `HH:MM` string, or `null`. */
function parseTimeOfDay(raw: unknown): number | null {
	if (typeof raw !== "string") return null;
	const match = TIME_OF_DAY.exec(raw.trim());
	if (!match) return null;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (hours > 23 || minutes > 59) return null;
	return hours * 60 + minutes;
}

/**
 * Parse one peak window; a malformed window is dropped rather than guessed.
 *
 * A `to` equal to `from` states no duration, so it is treated as malformed.
 */
export function parseWindow(raw: unknown): PeakWindow | null {
	const value = asRecord(raw);
	if (!value) return null;
	const days = parseDays(value.days);
	const from = parseTimeOfDay(value.from);
	const to = parseTimeOfDay(value.to);
	if (!days || from === null || to === null || from === to) return null;
	return { days, from, to };
}

/** A formatter resolving the weekday and h23 time of day in `timezone`. */
export function peakFormatter(timezone: string): Intl.DateTimeFormat {
	return new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});
}

/** Whether the local time of `at` falls inside a peak window. */
export function isPeak(schedule: PeakSchedule, at: number, format: Intl.DateTimeFormat): boolean {
	// No windows stated means the rate is flat, so every moment is peak.
	if (schedule.windows.length === 0) return true;
	const parts = format.formatToParts(at);
	let weekday = 0;
	let minutes = 0;
	for (const part of parts) {
		if (part.type === "weekday") weekday = WEEKDAYS[part.value] ?? 0;
		else if (part.type === "hour") minutes = Number(part.value) * 60;
		else if (part.type === "minute") minutes += Number(part.value);
	}
	return schedule.windows.some((window) => covers(window, weekday, minutes));
}

/**
 * Whether a weekday and time of day fall inside a window.
 *
 * `from` is inclusive and `to` exclusive. A `to` before `from` wraps midnight,
 * and the tail after midnight belongs to the day the window opened, so a
 * Monday 22:00–02:00 window covers Tuesday 00:00–02:00 too.
 */
function covers(window: PeakWindow, weekday: number, minutes: number): boolean {
	if (window.to > window.from) return window.days.includes(weekday) && minutes >= window.from && minutes < window.to;
	if (minutes >= window.from) return window.days.includes(weekday);
	const previous = weekday === 1 ? 7 : weekday - 1;
	return window.days.includes(previous) && minutes < window.to;
}
