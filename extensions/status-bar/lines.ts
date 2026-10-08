/**
 * Turn a `StatusSnapshot` into the two footer lines.
 *
 * Line 1 — identity: left `pwd · ⎇ branch`, right the worktree status.
 * Line 2 — resources: left the plan/alert statuses then the context gauge and
 * usage meters, right the model and thinking level.
 *
 * Each segment carries progressively shorter `forms` and a `weight`. The layout
 * engine advances forms and drops segments from the highest weight down, so the
 * bar degrades predictably instead of clipping arbitrary text.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { CONFIG } from "./config.ts";
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
} from "./format.ts";
import type { LineSpec, Segment, StatusSnapshot } from "./types.ts";

const dim = (theme: Theme, text: string): string => theme.fg("dim", text);

function pwdSegment(snapshot: StatusSnapshot, theme: Theme, home: string | undefined): Segment {
	return {
		id: "pwd",
		weight: 2,
		droppable: false,
		separator: "",
		forms: [
			dim(theme, formatCwd(snapshot.cwd, home, 0)),
			dim(theme, formatCwd(snapshot.cwd, home, 1)),
			dim(theme, formatCwd(snapshot.cwd, home, 2)),
		],
	};
}

function branchSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	if (!snapshot.branch) return null;
	const detached = snapshot.branch === CONFIG.labels.detached;
	const color = detached ? "warning" : "customMessageLabel";
	const icon = detached ? CONFIG.icons.detached : CONFIG.icons.branch;
	return {
		id: "branch",
		weight: 1,
		droppable: false,
		separator: dim(theme, CONFIG.separators.item),
		forms: [
			theme.fg(color, `${icon} ${snapshot.branch}`),
			theme.fg(color, `${CONFIG.icons.branch} ${snapshot.branch}`),
			// The floor keeps the detached warning glyph instead of falling back
			// to a plain branch icon, which would hide the detached state.
			theme.fg(color, icon),
		],
	};
}

function worktreeSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	const raw = snapshot.statuses.get(CONFIG.worktreeStatusKey);
	if (!raw) return null;
	const icon = CONFIG.icons.worktree;
	const label = sanitize(stripAnsi(raw)).replace(/^\S+\s*/, "").trim();
	if (!label) {
		return { id: "worktree", weight: 3, droppable: true, separator: dim(theme, CONFIG.separators.item), forms: [theme.fg("success", icon)] };
	}
	const short = truncateLabel(label, CONFIG.worktreeLabelMax);
	const forms = [theme.fg("success", `${icon} ${label}`)];
	if (short !== label) forms.push(theme.fg("success", `${icon} ${short}`));
	forms.push(theme.fg("success", icon));
	return {
		id: "worktree",
		weight: 3,
		droppable: true,
		separator: dim(theme, CONFIG.separators.item),
		forms,
	};
}

function modesSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	const others = [...snapshot.statuses.entries()]
		.filter(([key]) => key !== CONFIG.worktreeStatusKey)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, value]) => sanitize(value))
		.filter(Boolean);
	if (others.length === 0) return null;
	const full = others.join(dim(theme, CONFIG.separators.item));
	// Derive the compact form from plain text: a themed status carries an
	// opening SGR code but the reset is lost when we keep only the first token,
	// which would bleed its color into the rest of the line. A two-token badge
	// keeps its count (`↺ 2` -> `↺2`) instead of collapsing to a bare icon.
	const icons = others.map((status) => compactStatus(status)).join(" ");
	return { id: "statuses", weight: 1, droppable: false, separator: dim(theme, CONFIG.separators.group), forms: [full, icons] };
}

function contextSegment(snapshot: StatusSnapshot, theme: Theme): Segment {
	const percent = snapshot.context.percent;
	const color = contextColor(percent);
	const percentText = theme.fg(color, formatPercent(percent));
	const forms = CONFIG.gauge.widths.map((blocks) => {
		const { filled, empty } = computeGauge(percent, blocks);
		const gauge =
			blocks > 0
				? theme.fg(color, CONFIG.gauge.full.repeat(filled)) +
					theme.fg("dim", CONFIG.gauge.empty.repeat(empty)) +
					" "
				: "";
		return `${gauge}${percentText}`;
	});
	return {
		id: "context",
		weight: 1,
		droppable: false,
		separator: "",
		forms,
	};
}

function windowSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	if (snapshot.context.contextWindow <= 0) return null;
	return {
		id: "window",
		weight: 3,
		droppable: true,
		separator: "",
		forms: [dim(theme, `/${formatTokens(snapshot.context.contextWindow)}`)],
	};
}

function costSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	if (snapshot.usage.cost === 0) return null;
	return {
		id: "cost",
		weight: 2,
		droppable: true,
		separator: dim(theme, CONFIG.separators.item),
		forms: [
			theme.fg("muted", formatCost(snapshot.usage.cost)),
			theme.fg("muted", formatCost(snapshot.usage.cost, true)),
		],
	};
}

function tokensSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	const { input, output } = snapshot.usage;
	if (input === 0 && output === 0) return null;
	const parts: string[] = [];
	if (input > 0) parts.push(`↑${formatTokens(input)}`);
	if (output > 0) parts.push(`↓${formatTokens(output)}`);
	return {
		id: "tokens",
		weight: 4,
		droppable: true,
		separator: dim(theme, CONFIG.separators.item),
		forms: [dim(theme, parts.join(" "))],
	};
}

function cacheSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	const { cacheRead, cacheWrite } = snapshot.usage;
	const cached = cacheRead > 0 || cacheWrite > 0;
	const parts: string[] = [];
	if (cacheRead > 0) parts.push(`R${formatTokens(cacheRead)}`);
	if (cacheWrite > 0) parts.push(`W${formatTokens(cacheWrite)}`);
	// A hit rate is meaningful only once something was actually cached; an
	// assistant turn with no cache reports `0`, which would otherwise render a
	// lone `CH 0%` (the built-in footer guards this the same way).
	if (cached && snapshot.cacheHitRate !== null) parts.push(`CH ${Math.round(snapshot.cacheHitRate)}%`);
	if (parts.length === 0) return null;
	return {
		id: "cache",
		weight: 5,
		droppable: true,
		separator: dim(theme, CONFIG.separators.item),
		forms: [dim(theme, parts.join(" "))],
	};
}

function modelSegment(snapshot: StatusSnapshot, theme: Theme): Segment {
	const model = snapshot.model;
	const id = model?.id ?? CONFIG.labels.noModel;
	const provider = model && snapshot.providerCount > 1 ? `(${model.provider}) ` : "";
	return {
		id: "model",
		weight: 1,
		droppable: false,
		separator: "",
		forms: [theme.fg("accent", `${provider}${id}`), theme.fg("accent", id)],
	};
}

function thinkingSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	if (!snapshot.model?.reasoning || !snapshot.thinkingLevel) return null;
	const color = thinkingColor(snapshot.thinkingLevel);
	return {
		id: "thinking",
		weight: 2,
		droppable: true,
		separator: dim(theme, CONFIG.separators.item),
		forms: [theme.fg(color, snapshot.thinkingLevel)],
	};
}

function defined(segments: Array<Segment | null>): Segment[] {
	return segments.filter((segment): segment is Segment => segment !== null);
}

/** Build the identity and resources lines for a snapshot. */
export function buildLines(snapshot: StatusSnapshot, theme: Theme, home: string | undefined): LineSpec[] {
	const line1: LineSpec = {
		left: defined([pwdSegment(snapshot, theme, home)]),
		right: defined([branchSegment(snapshot, theme), worktreeSegment(snapshot, theme)]),
	};

	const line2Left = defined([
		contextSegment(snapshot, theme),
		windowSegment(snapshot, theme),
		costSegment(snapshot, theme),
		tokensSegment(snapshot, theme),
		cacheSegment(snapshot, theme),
		modesSegment(snapshot, theme),
	]);

	const line2Right = defined([modelSegment(snapshot, theme), thinkingSegment(snapshot, theme)]);

	return [line1, { left: line2Left, right: line2Right }];
}
