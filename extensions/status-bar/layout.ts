/**
 * Width-aware rendering for one footer line.
 *
 * A line has a left and a right zone. On a wide terminal the right zone is
 * right-aligned; when space runs out it folds next to the left zone, and then
 * segments shrink and drop from the highest weight down. Terminal-width
 * measurement uses `visibleWidth`, so ANSI styling and wide characters count
 * correctly.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { CONFIG } from "./config.ts";
import type { LineSpec, Segment } from "./types.ts";

type Zone = "left" | "right";

interface State {
	segment: Segment;
	zone: Zone;
	form: number;
	dropped: boolean;
	/** Rendered before the segment; shrinks to a single space as a last resort. */
	separator: string;
	/** True once the separator has been collapsed to a single space. */
	separatorCompact: boolean;
	order: number;
}

function makeStates(spec: LineSpec): State[] {
	const states: State[] = [];
	let order = 0;
	const push = (segment: Segment, zone: Zone): void => {
		states.push({
			segment,
			zone,
			form: 0,
			dropped: false,
			separator: segment.separator,
			separatorCompact: false,
			order: order++,
		});
	};
	for (const segment of spec.left) push(segment, "left");
	for (const segment of spec.right) push(segment, "right");
	return states;
}

function composeZone(states: State[], zone: Zone): string {
	let out = "";
	let first = true;
	for (const state of states) {
		if (state.zone !== zone || state.dropped) continue;
		const text = state.segment.forms[Math.min(state.form, state.segment.forms.length - 1)] ?? "";
		if (!text) continue;
		out += (first ? "" : state.separator) + text;
		first = false;
	}
	return out;
}

function assemble(states: State[], width: number): string {
	const left = composeZone(states, "left");
	const right = composeZone(states, "right");
	if (!right) return left;
	if (!left) return " ".repeat(Math.max(0, width - visibleWidth(right))) + right;

	const leftWidth = visibleWidth(left);
	const rightWidth = visibleWidth(right);
	if (leftWidth + CONFIG.minGap + rightWidth <= width) {
		return left + " ".repeat(width - leftWidth - rightWidth) + right;
	}
	return `${left}${" ".repeat(CONFIG.minGap)}${right}`;
}

/** Advance the form of, or drop, the lowest-priority segment that can change. */
function reduceOnce(states: State[]): boolean {
	let best: State | null = null;
	for (const state of states) {
		if (state.dropped) continue;
		const atFloor = state.form >= state.segment.forms.length - 1;
		if (atFloor && !state.segment.droppable) continue;
		if (
			!best ||
			state.segment.weight > best.segment.weight ||
			(state.segment.weight === best.segment.weight && state.order > best.order)
		) {
			best = state;
		}
	}

	if (!best) return false;
	if (best.form < best.segment.forms.length - 1) best.form++;
	else best.dropped = true;
	return true;
}

/** Collapse the lowest-priority padded separator to a single space, as a last
 *  resort. A single space is kept so adjacent segments never collide; the
 *  first visible segment in each zone has no separator to collapse. */
function collapseSeparator(states: State[]): boolean {
	const firstLeft = states.find((state) => state.zone === "left" && !state.dropped);
	const firstRight = states.find((state) => state.zone === "right" && !state.dropped);
	let best: State | null = null;
	for (const state of states) {
		if (state.dropped || !state.separator || state.separatorCompact) continue;
		if (state === firstLeft || state === firstRight) continue;
		if (
			!best ||
			state.segment.weight > best.segment.weight ||
			(state.segment.weight === best.segment.weight && state.order > best.order)
		) {
			best = state;
		}
	}
	if (!best) return false;
	best.separator = " ";
	best.separatorCompact = true;
	return true;
}

/** Render one line to a single string no wider than `width`. */
export function renderLine(spec: LineSpec, width: number, theme: Theme): string {
	const target = Math.max(1, width);
	const states = makeStates(spec);

	let guard = 0;
	while (visibleWidth(assemble(states, target)) > target && guard++ < states.length * 8 + 16) {
		if (!reduceOnce(states)) break;
	}
	// Only once every segment is at its floor do we shrink separators, so the
	// truncation ellipsis never replaces a separator's content and adjacent
	// segments always keep at least one column of padding between them.
	while (visibleWidth(assemble(states, target)) > target) {
		if (!collapseSeparator(states)) break;
	}

	return truncateToWidth(assemble(states, target), target, theme.fg("dim", "…"));
}
