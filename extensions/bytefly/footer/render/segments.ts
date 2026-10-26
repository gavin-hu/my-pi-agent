/**
 * The individual footer segments.
 *
 * Each segment carries progressively shorter `forms` and a `weight`; the layout
 * engine advances forms and drops segments from the highest weight down, so the
 * bar degrades predictably instead of clipping arbitrary text. Colors come from
 * the design-system roles, so the bar follows the active theme.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { formatTokens, sanitize, sanitizeLine } from "../../../../lib/format.ts";
import { gaugeBar } from "../../../../lib/tui/gauge.ts";
import { chip } from "../../../../lib/tui/rows.ts";
import { paint } from "../../../../lib/tui/tokens.ts";
import { budgetState } from "../budget.ts";
import { CONFIG } from "../config.ts";
import {
	contextRole,
	formatCost,
	formatCwd,
	formatLimit,
	formatPercent,
	thinkingColor,
	truncateLabel,
} from "./format.ts";
import { compactStatus, dropStatusDetail } from "./status.ts";
import type { Segment, StatusSnapshot } from "../types.ts";

/** Tertiary text: paths and de-emphasized meters. */
const faint = (theme: Theme, text: string): string => paint(theme, "faint", text);

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
			faint(theme, formatCwd(snapshot.cwd, home, 0)),
			faint(theme, formatCwd(snapshot.cwd, home, 1)),
			faint(theme, formatCwd(snapshot.cwd, home, 2)),
		],
	};
}

export function sessionSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	const name = snapshot.sessionName ? sanitizeLine(snapshot.sessionName) : "";
	if (!name) return null;
	const short = truncateLabel(name, CONFIG.sessionLabelMax);
	// Brackets and a brighter token keep the session name from reading as a
	// trailing path segment.
	const forms = [paint(theme, "meta", `[${name}]`)];
	if (short !== name) forms.push(paint(theme, "meta", `[${short}]`));
	return {
		id: "session",
		weight: 3,
		droppable: true,
		separator: faint(theme, CONFIG.separators.item),
		forms,
	};
}

export function branchSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	if (!snapshot.branch) return null;
	const detached = snapshot.branch === CONFIG.labels.detached;
	const icon = detached ? CONFIG.icons.detached : CONFIG.icons.branch;
	return {
		id: "branch",
		weight: 1,
		droppable: true,
		separator: faint(theme, CONFIG.separators.item),
		forms: [chip(theme, icon, snapshot.branch, detached ? "warn" : "meta")],
	};
}

export function worktreeSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	const raw = snapshot.statuses.get(CONFIG.worktreeStatusKey);
	if (!raw) return null;
	const icon = CONFIG.icons.worktree;
	const separator = faint(theme, CONFIG.separators.item);
	const label = chipLabel(raw);
	if (!label) {
		return { id: "worktree", weight: 3, droppable: true, separator, forms: [paint(theme, "ok", icon)] };
	}
	const short = truncateLabel(label, CONFIG.worktreeLabelMax);
	const forms = [chip(theme, icon, label, "ok")];
	if (short !== label) forms.push(chip(theme, icon, short, "ok"));
	forms.push(paint(theme, "ok", icon));
	return { id: "worktree", weight: 3, droppable: true, separator, forms };
}

export function browseSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	const raw = snapshot.statuses.get(CONFIG.browseStatusKey);
	if (!raw) return null;
	const icon = CONFIG.icons.browse;
	const label = chipLabel(raw);
	const separator = faint(theme, CONFIG.separators.item);
	if (!label) {
		return { id: "browse", weight: 3, droppable: true, separator, forms: [paint(theme, "ok", icon)] };
	}
	// A two-tone chip: the `◉` glyph stays green while the port reads as accent.
	return {
		id: "browse",
		weight: 3,
		droppable: true,
		separator,
		forms: [
			`${paint(theme, "ok", icon)} ${paint(theme, "accent", label)}`,
			`${paint(theme, "ok", icon)}${paint(theme, "accent", label)}`,
			paint(theme, "ok", icon),
		],
	};
}

/** Whether a status key names an alert instead of a mode. */
function isAlert(key: string): boolean {
	return CONFIG.alertStatusKeys.includes(key);
}

/**
 * The alerts: a failed job, and anything else whose chip means "this broke".
 *
 * Not droppable, because every other fact on the bar can be read again from
 * somewhere — the branch from git, the mode from the session — and a failure
 * that scrolled off the bar is a failure nobody is looking at. It gives up its
 * text last, keeping the count (`✗1`) instead of collapsing to a bare glyph.
 */
export function alertSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	const alerts = [...snapshot.statuses.entries()]
		.filter(([key]) => isAlert(key))
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, value]) => sanitize(value))
		.filter(Boolean);
	if (alerts.length === 0) return null;
	const separator = faint(theme, CONFIG.separators.item);
	return {
		id: "alert",
		weight: 1,
		droppable: false,
		separator,
		forms: [alerts.join(separator), alerts.map((status) => compactStatus(status)).join(" ")],
	};
}

export function modesSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	const others = [...snapshot.statuses.entries()]
		.filter(([key]) => key !== CONFIG.worktreeStatusKey && key !== CONFIG.browseStatusKey && !isAlert(key))
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => {
			const status = sanitize(value);
			// The plan chip trails the plan file name; the slot shows the mode only.
			return key === CONFIG.planStatusKey ? dropStatusDetail(status) : status;
		})
		.filter(Boolean);
	if (others.length === 0) return null;
	const full = others.join(faint(theme, CONFIG.separators.item));
	// The compact form keeps each status's own colour (see `compactStatus`); a
	// two-token badge keeps its count (`↺ 2` -> `↺2`) instead of collapsing to a
	// bare icon.
	const icons = others.map((status) => compactStatus(status)).join(" ");
	return {
		id: "statuses",
		// Weight 2, ahead of the branch: a mode is stated again by the session, while
		// `⎇` is the only thing on the bar that says where the work will land.
		weight: 2,
		droppable: true,
		separator: faint(theme, CONFIG.separators.item),
		forms: [full, icons],
	};
}

export function contextSegment(snapshot: StatusSnapshot, theme: Theme): Segment {
	const percent = snapshot.context.percent;
	const role = contextRole(percent);
	const percentText = paint(theme, role, formatPercent(percent));
	// Unknown usage draws no track, so `?` sits where the gauge would be rather
	// than a full row of empty blocks claiming a known zero.
	const widths: readonly number[] = percent === null ? [0] : CONFIG.gauge.widths;
	const forms = widths.map((blocks) =>
		blocks > 0 ? `${gaugeBar(theme, { percent, blocks, role, emptyRole: "faint" })} ${percentText}` : percentText,
	);
	return { id: "context", weight: 1, droppable: false, separator: "", forms };
}

export function windowSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	if (snapshot.context.contextWindow <= 0) return null;
	return {
		id: "window",
		weight: 3,
		droppable: true,
		separator: "",
		forms: [faint(theme, `/${formatTokens(snapshot.context.contextWindow)}`)],
	};
}

/**
 * What the session cost, and how many records the total leaves out.
 *
 * A session whose every record went unpriced has a total of zero, and a segment that
 * vanished at zero was the loudest version of the silence: nothing on the bar said the
 * work was unpriced rather than free. So the count is its own fact, and the price comes
 * first where there is one — the narrower forms drop the price before the warning.
 *
 * A configured budget turns the price into a position: `$0.31/$5`, drawn in `warn` once
 * the spend reaches the ceiling. That is the condition the budget notice fires on, read
 * from the same `budgetState`, so the bar cannot call a session over budget that the
 * notice has not, and the ceiling is visible from the first frame rather than only in
 * the one notice that names it.
 */
export function costSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	const { cost, unpriced } = snapshot.usage;
	const budget = snapshot.budget;
	if (cost === 0 && unpriced === 0 && budget <= 0) return null;
	const price = formatCost(cost, snapshot.currency);
	const spend = budget > 0 ? `${price}/${formatLimit(budget, snapshot.currency)}` : price;
	const spendText = paint(theme, budgetState(budget, cost).exceeded ? "warn" : "meta", spend);
	const leftOut = unpriced === 1 ? "1 unpriced" : `${unpriced} unpriced`;
	// A zero total with no ceiling says nothing a reader can use, so the price form
	// appears only once there is a spend or a budget to hold it against.
	const priced = cost === 0 && budget <= 0 ? [] : [spendText];
	const forms = [
		`${spendText}${faint(theme, CONFIG.separators.item)}${paint(theme, "warn", leftOut)}`,
		paint(theme, "warn", leftOut),
		...priced,
	];
	return {
		id: "cost",
		weight: 2,
		droppable: true,
		separator: faint(theme, CONFIG.separators.item),
		forms: unpriced === 0 ? [spendText] : forms,
	};
}

/**
 * Child-run spend, next to the session's own cost and never inside it: a
 * subagent runs in its own process, so its tokens are not the session's. The
 * roll-up covers the ledger's retained window (the last 500 runs).
 */
export function delegationSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	const { runs, usage } = snapshot.delegation;
	if (runs === 0) return null;
	const icon = CONFIG.icons.delegation;
	const cost = formatCost(usage.cost, snapshot.currency);
	// Detailed first; the run count survives longer than the price, because "some
	// delegation happened" is the part a narrow bar can still say.
	const forms = [
		`${paint(theme, "meta", `${icon} ${runs} · ${cost}`)}`,
		`${paint(theme, "meta", `${icon} ${cost}`)}`,
		paint(theme, "meta", `${icon} ${runs}`),
		paint(theme, "meta", icon),
	];
	return {
		id: "delegation",
		weight: 4,
		droppable: true,
		separator: faint(theme, CONFIG.separators.item),
		forms,
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
		separator: faint(theme, CONFIG.separators.item),
		forms: [faint(theme, parts.join(" "))],
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
		separator: faint(theme, CONFIG.separators.item),
		forms: [faint(theme, parts.join(" "))],
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
			forms: [paint(theme, "meta", CONFIG.labels.noModel)],
		};
	}
	// Only several providers make the name ambiguous, and an id that already carries
	// its provider (`deepseek/deepseek-v4-pro`) would only say it twice.
	const qualify = snapshot.providerCount > 1 && !model.id.toLowerCase().startsWith(model.provider.toLowerCase());
	const provider = qualify ? `(${model.provider}) ` : "";
	return {
		id: "model",
		weight: 1,
		droppable: false,
		separator: "",
		forms: [paint(theme, "accent", `${provider}${model.id}`), paint(theme, "accent", model.id)],
	};
}

export function thinkingSegment(snapshot: StatusSnapshot, theme: Theme): Segment | null {
	if (!snapshot.model?.reasoning) return null;
	const level = snapshot.thinkingLevel ?? "off";
	// The reasoning scale is Pi's own seven-token ramp, not a design role: a
	// level colors itself from `thinkingColor`.
	const color = thinkingColor(level);
	return {
		id: "thinking",
		weight: 2,
		droppable: true,
		separator: faint(theme, CONFIG.separators.item),
		forms: [theme.fg(color, level)],
	};
}
