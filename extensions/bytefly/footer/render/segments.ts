/**
 * The individual footer segments.
 *
 * Each segment carries progressively shorter `forms` and a `weight`; the layout
 * engine advances forms and drops segments from the highest weight down, so the
 * bar degrades predictably instead of clipping arbitrary text.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { formatTokens, sanitize, sanitizeLine } from "../../../../lib/format.ts";
import { CONFIG } from "../config.ts";
import {
	computeGauge,
	contextColor,
	formatCost,
	formatCwd,
	formatPercent,
	thinkingColor,
	truncateLabel,
} from "./format.ts";
import { compactStatus, dropStatusDetail } from "./status.ts";
import type { Segment, StatusSnapshot } from "../types.ts";

const dim = (theme: Theme, text: string): string => theme.fg("dim", text);

/**
 * The label part of a themed status chip: strip its escape sequences, sanitize
 * it to one safe line, then drop the leading icon.
 */
function chipLabel(raw: string): string {
	return sanitizeLine(stripTerminalSequences(raw))
		.replace(/^\S+\s*/, "")
		.trim();
}

export function pwdSegment(snapshot: StatusSnapshot, theme: Theme, home: string | undefined): Segment {
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

export function sessionSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	const name = snapshot.sessionName ? sanitizeLine(snapshot.sessionName) : "";
	if (!name) return null;
	const short = truncateLabel(name, CONFIG.sessionLabelMax);
	// Brackets and a brighter token keep the session name from reading as a
	// trailing path segment.
	const forms = [theme.fg("muted", `[${name}]`)];
	if (short !== name) forms.push(theme.fg("muted", `[${short}]`));
	return {
		id: "session",
		weight: 3,
		droppable: true,
		separator: dim(theme, CONFIG.separators.item),
		forms,
	};
}

export function branchSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	if (!snapshot.branch) return null;
	const detached = snapshot.branch === CONFIG.labels.detached;
	const color = detached ? "warning" : "muted";
	const icon = detached ? CONFIG.icons.detached : CONFIG.icons.branch;
	return {
		id: "branch",
		weight: 1,
		droppable: true,
		separator: dim(theme, CONFIG.separators.item),
		forms: [theme.fg(color, `${icon} ${snapshot.branch}`)],
	};
}

export function worktreeSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	const raw = snapshot.statuses.get(CONFIG.worktreeStatusKey);
	if (!raw) return null;
	const icon = CONFIG.icons.worktree;
	const label = chipLabel(raw);
	if (!label) {
		return {
			id: "worktree",
			weight: 3,
			droppable: true,
			separator: dim(theme, CONFIG.separators.item),
			forms: [theme.fg("success", icon)],
		};
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

export function browseSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	const raw = snapshot.statuses.get(CONFIG.browseStatusKey);
	if (!raw) return null;
	const icon = CONFIG.icons.browse;
	const label = chipLabel(raw);
	const separator = dim(theme, CONFIG.separators.item);
	if (!label) {
		return {
			id: "browse",
			weight: 3,
			droppable: true,
			separator,
			forms: [theme.fg("success", icon)],
		};
	}
	return {
		id: "browse",
		weight: 3,
		droppable: true,
		separator,
		forms: [
			`${theme.fg("success", icon)} ${theme.fg("accent", label)}`,
			`${theme.fg("success", icon)}${theme.fg("accent", label)}`,
			theme.fg("success", icon),
		],
	};
}

/** Sort rank: an alert (a failed job) leads the slot; modes follow by key. */
function statusRank(key: string): number {
	return key === CONFIG.jobsFailureStatusKey ? 0 : 1;
}

export function modesSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	const others = [...snapshot.statuses.entries()]
		.filter(([key]) => key !== CONFIG.worktreeStatusKey && key !== CONFIG.browseStatusKey)
		.sort(([a], [b]) => statusRank(a) - statusRank(b) || a.localeCompare(b))
		.map(([key, value]) => {
			const status = sanitize(value);
			// The plan chip trails the plan file name; the slot shows the mode only.
			return key === CONFIG.planStatusKey ? dropStatusDetail(status) : status;
		})
		.filter(Boolean);
	if (others.length === 0) return null;
	const full = others.join(dim(theme, CONFIG.separators.item));
	// The compact form keeps each status's own colour (see `compactStatus`); a
	// two-token badge keeps its count (`↺ 2` -> `↺2`) instead of collapsing to a
	// bare icon.
	const icons = others.map((status) => compactStatus(status)).join(" ");
	return {
		id: "statuses",
		// The last thing to go, but droppable: a tight bar drops the slot rather
		// than truncating the model, which sits at the end of the line.
		weight: 1,
		droppable: true,
		separator: dim(theme, CONFIG.separators.group),
		forms: [full, icons],
	};
}

export function contextSegment(snapshot: StatusSnapshot, theme: Theme): Segment {
	const percent = snapshot.context.percent;
	const color = contextColor(percent);
	const percentText = theme.fg(color, formatPercent(percent));
	const gaugeWidths: readonly number[] = percent === null ? [0] : CONFIG.gauge.widths;
	const forms = gaugeWidths.map((blocks) => {
		const { filled, empty } = computeGauge(percent, blocks);
		const gauge =
			blocks > 0
				? theme.fg(color, CONFIG.gauge.full.repeat(filled)) + theme.fg("dim", CONFIG.gauge.empty.repeat(empty)) + " "
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

export function windowSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	if (snapshot.context.contextWindow <= 0) return null;
	return {
		id: "window",
		weight: 3,
		droppable: true,
		separator: "",
		forms: [dim(theme, `/${formatTokens(snapshot.context.contextWindow)}`)],
	};
}

export function costSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	if (snapshot.usage.cost === 0) return null;
	return {
		id: "cost",
		weight: 2,
		droppable: true,
		separator: dim(theme, CONFIG.separators.item),
		forms: [theme.fg("muted", formatCost(snapshot.usage.cost, snapshot.currency))],
	};
}

export function tokensSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
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

export function cacheSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
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

export function modelSegment(snapshot: StatusSnapshot, theme: Theme): Segment {
	const model = snapshot.model;
	if (!model) {
		// No model selected: a muted note, not an accent-colored pseudo-model.
		return {
			id: "model",
			weight: 1,
			droppable: false,
			separator: "",
			forms: [theme.fg("muted", CONFIG.labels.noModel)],
		};
	}
	const provider = snapshot.providerCount > 1 ? `(${model.provider}) ` : "";
	return {
		id: "model",
		weight: 1,
		droppable: false,
		separator: "",
		forms: [theme.fg("accent", `${provider}${model.id}`), theme.fg("accent", model.id)],
	};
}

export function thinkingSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	if (!snapshot.model?.reasoning) return null;
	const level = snapshot.thinkingLevel ?? "off";
	const color = thinkingColor(level);
	return {
		id: "thinking",
		weight: 2,
		droppable: true,
		separator: dim(theme, CONFIG.separators.item),
		forms: [theme.fg(color, level)],
	};
}
