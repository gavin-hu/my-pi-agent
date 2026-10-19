/**
 * Long-session render benchmark (dev tooling).
 *
 * A transcript re-renders every block on every frame, so the cost that makes a
 * long session feel slow is per block, per frame. This script builds a session of
 * 500 and 2000 tool blocks through the real renderers (the same fixtures and
 * resolver the gallery uses) and reports, per width, what a frame costs: lines,
 * median and p95 frame time, heap per frame, and how many blocks came back from
 * their render memo instead of being rebuilt.
 *
 * Two different questions, kept apart:
 *
 * - **Deterministic, and gated:** the same input must produce the same line
 *   array. That is a correctness property — a renderer that reads a clock or
 *   accumulates state across frames would show it — so the test beside this file
 *   asserts it, and the CLI exits non-zero when it fails.
 * - **Wall-clock and cache hits, and read by a person:** both depend on the
 *   machine and on which host renderers build fresh arrays (Pi's `Container`
 *   does, by design), so they are a pre-release reading compared against the
 *   budget in `docs/development.md`, never a CI threshold.
 *
 *   render-bench.ts            the table above, plus the determinism gate
 */

import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { renderingComponents } from "./tool-renderings.ts";

/** One measured transcript shape. */
export interface BenchCase {
	blocks: number;
	width: number;
}

/** The sizes and widths `docs/development.md` names as the budget. */
export const CASES: readonly BenchCase[] = [
	{ blocks: 500, width: 80 },
	{ blocks: 500, width: 120 },
	{ blocks: 2000, width: 80 },
	{ blocks: 2000, width: 120 },
];

/** Frames timed per case, after one warm-up frame. */
const FRAMES = 20;

/** A transcript's components, kept so a frame re-renders instead of rebuilding. */
export type Session = Component[];

/**
 * `blocks` tool blocks, cycling through every fixture so heights and content
 * vary the way a real session's do.
 */
export function session(blocks: number): Session {
	const fixtures = renderingComponents().flatMap((rendering) => rendering.components);
	if (fixtures.length === 0) throw new Error("no tool renderings to benchmark");
	const components: Session = [];
	for (let index = 0; index < blocks; index++) components.push(fixtures[index % fixtures.length]);
	return components;
}

/** One frame: render every block, exactly as the host's tree walk does. */
export function frame(session: Session, width: number): string[] {
	const lines: string[] = [];
	for (const component of session) lines.push(...component.render(width));
	return lines;
}

/**
 * Whether two frames of the same session are the same lines.
 *
 * This is the gate: a block whose output depends on anything but its own state
 * and the width — a clock, a growing counter — fails here.
 */
export function deterministic(session: Session, width: number): boolean {
	return frame(session, width).join("\n") === frame(session, width).join("\n");
}

/** How many blocks a repeat frame served from their render memo. */
export function cacheHits(session: Session, width: number): number {
	const first = session.map((component) => component.render(width));
	return session.filter((component, index) => component.render(width) === first[index]).length;
}

/** Whether every line fits the width it was rendered at. */
export function fitsWidth(lines: readonly string[], width: number): boolean {
	return lines.every((line) => visibleWidth(line) <= width);
}

/** One case's readings. Timings and heap are indicative; `stable` is not. */
export interface BenchResult extends BenchCase {
	lines: number;
	medianMs: number;
	p95Ms: number;
	heapMbPerFrame: number | undefined;
	/** Blocks served from their render memo on a repeat frame. */
	cacheHits: number;
	/** Blocks in the session (two components per tool row is normal). */
	components: number;
	stable: boolean;
}

/** Median of a list of durations. */
function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** The value at the 95th percentile, nearest-rank. */
function p95(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

/** Force a collection when the runtime exposes one, so heap readings settle. */
function collect(): void {
	(globalThis as { Bun?: { gc?: (force: boolean) => void } }).Bun?.gc?.(true);
}

/** Measure one transcript shape. */
export function measure(benchCase: BenchCase): BenchResult {
	const components = session(benchCase.blocks);
	// Warm up: the first frame builds every block, which is not a steady-state frame.
	const lines = frame(components, benchCase.width).length;

	const durations: number[] = [];
	for (let index = 0; index < FRAMES; index++) {
		const started = performance.now();
		frame(components, benchCase.width);
		durations.push(performance.now() - started);
	}

	collect();
	const before = process.memoryUsage().heapUsed;
	for (let index = 0; index < FRAMES; index++) frame(components, benchCase.width);
	collect();
	const after = process.memoryUsage().heapUsed;

	return {
		...benchCase,
		lines,
		medianMs: median(durations),
		p95Ms: p95(durations),
		// A frame that allocates nothing can read as a small negative delta after a
		// collection; report the floor instead of a "-0.00 MB".
		heapMbPerFrame: Math.max(0, (after - before) / FRAMES / (1024 * 1024)),
		cacheHits: cacheHits(components, benchCase.width),
		components: components.length,
		stable: deterministic(components, benchCase.width),
	};
}

/** `bun run bench:render` */
if (import.meta.main) {
	const results = CASES.map((benchCase) => measure(benchCase));
	const header = ["blocks", "width", "lines", "median", "p95", "heap/frame", "memo", "stable"];
	const rows = results.map((result) => [
		String(result.blocks),
		String(result.width),
		result.lines.toLocaleString("en-US"),
		`${result.medianMs.toFixed(1)}ms`,
		`${result.p95Ms.toFixed(1)}ms`,
		result.heapMbPerFrame === undefined ? "?" : `${result.heapMbPerFrame.toFixed(2)} MB`,
		`${result.cacheHits}/${result.components}`,
		result.stable ? "yes" : "NO",
	]);
	const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
	const format = (cells: string[]): string => cells.map((cell, column) => cell.padEnd(widths[column])).join("  ");
	console.log(format(header));
	for (const row of rows) console.log(format(row));

	const unstable = results.filter((result) => !result.stable);
	const misfit = results.filter((result) => !fitsWidth(frame(session(result.blocks), result.width), result.width));
	if (unstable.length > 0) {
		console.error(`\nA frame was not deterministic for: ${unstable.map((r) => `${r.blocks} @${r.width}`).join(", ")}`);
		process.exit(1);
	}
	if (misfit.length > 0) {
		console.error(`\nA line overflowed its width for: ${misfit.map((r) => `${r.blocks} @${r.width}`).join(", ")}`);
		process.exit(1);
	}
}
