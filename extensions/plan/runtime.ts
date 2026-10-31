/**
 * Session-scoped state and tool gating for plan mode.
 *
 * Enabling plan mode removes every tool the policy does not consider read-only
 * from the active set, and keeps the one `plan` tool active in both modes: its
 * actions are what ask to enter, save the artifact under the plans directory,
 * present it, tick it, and leave. Disabling restores exactly what it hid. The
 * enabled flag is persisted as a custom session entry so `/resume` and `/tree`
 * follow the branch, and it is also mirrored into the footer status. The review
 * baseline travels the same way, as one digest per heading section, so the
 * changed-section markers survive a resume too.
 *
 * The `plan` tool's `write` action is the one sanctioned write while planning. The
 * read-only guard in `index.ts` permits that tool only when the registered one is
 * this extension's (matched by source path), so a same-named tool from another
 * extension cannot borrow the exemption, and each action refuses outside its mode.
 */

import { basename, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../lib/format.ts";
import { PLAN_MODE_ENTRY_TYPE } from "../../lib/plan-state.ts";
import type { ReadOnlyPolicy } from "../../lib/policy.ts";
import { PLAN_TOOL as PLAN_TOOL_NAME } from "../../lib/tool-names.ts";
import { GLYPHS, STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { createPlanStore, type PlanStore } from "./plans.ts";
import { sameSections, sectionDigests, type SectionDigest } from "./plan-text.ts";
import type { PlanModeEntry, ReviewBaselineEntry, SeededStepsEntry } from "./types.ts";

/** The one model-facing tool: every planning verb is one of its actions. */
export const PLAN_TOOL = PLAN_TOOL_NAME;

/**
 * The verbs of the one `plan` tool, in the order the schema offers them.
 *
 * One action tool rather than five tools, so every verb shares a name and a
 * registration; the order is the one the description walks them in.
 */
export const PLAN_ACTIONS = ["enter", "write", "exit", "steps", "cancel"] as const;

/** One verb of the `plan` tool. */
export type PlanAction = (typeof PLAN_ACTIONS)[number];
/** Custom-entry type used for plan-mode state. */
export const STATE_TYPE = PLAN_MODE_ENTRY_TYPE;
/** Custom-entry type used for a plan's review baseline. */
export const BASELINE_TYPE = "plan-baseline";
/** Custom-entry type used for the steps one approval seeded, so a re-approval can replace them. */
export const SEEDED_TYPE = "plan-seeded";

/** Longest plan-file basename shown in the footer chip. */
const STATUS_NAME_LENGTH = 28;

/**
 * The one tool plan mode keeps in the active set in both modes. Every other tool
 * follows the policy, which is about writing files and cannot answer for a tool
 * whose actions are the mode's own verbs: hiding it while planning would hide the
 * way to write the plan and the way out.
 */
const MODE_TOOLS = [PLAN_TOOL];

export interface PlanRuntime {
	/** Whether plan mode is currently on. */
	isEnabled(): boolean;
	enable(ctx: ExtensionContext): void;
	disable(ctx: ExtensionContext): void;
	toggle(ctx: ExtensionContext): void;
	/** Restore state from the branch and the `--plan` flag. */
	restore(ctx: ExtensionContext): void;
	/** Plan-file storage for the `write` and `exit` actions. */
	plans: PlanStore;
	/** Whether `toolName` is the `plan` tool (not a same-named impostor) the read-only guard exempts. */
	isOwnTool(toolName: string): boolean;
	/** Path of the most recently written plan, for the footer chip. */
	lastPlanPath(): string | undefined;
	/** Remember a written plan and repaint the footer. */
	setLastPlan(ctx: ExtensionContext, path: string): void;
	/** The sections the last review of `path` showed, restored with the branch. */
	reviewed(path: string): SectionDigest[] | undefined;
	/** Remember what a review just showed, as a session entry on this branch. */
	markReviewed(path: string, content: string): void;
	/** The step texts the last approval of this plan appended, or undefined. */
	seeded(path: string): string[] | undefined;
	/** Record what this approval appended, so a re-approval can replace it. */
	markSeeded(path: string, steps: readonly string[]): void;
}

/** What the branch carries: the last plan-mode state, and a baseline per plan. */
interface BranchState {
	mode: PlanModeEntry | undefined;
	baselines: Map<string, SectionDigest[]>;
	/** The step texts each approval appended, per plan path. */
	seeded: Map<string, string[]>;
}

/** Well-formed `{ title, digest }` pairs from untrusted branch data, or undefined. */
function readSections(value: unknown): SectionDigest[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const sections: SectionDigest[] = [];
	for (const raw of value) {
		const section = raw as { title?: unknown; digest?: unknown; blocks?: unknown } | null | undefined;
		if (typeof section?.title !== "string" || typeof section.digest !== "string") return undefined;
		// Branch data is untrusted, so the block digests are kept only when they are a list
		// of strings: a baseline written before block marks simply has none, and one that
		// holds something else is read at section depth rather than repaired.
		const blocks = Array.isArray(section.blocks)
			? section.blocks.filter((entry): entry is string => typeof entry === "string")
			: undefined;
		sections.push(
			blocks === undefined
				? { title: section.title, digest: section.digest }
				: { title: section.title, digest: section.digest, blocks },
		);
	}
	return sections;
}

/**
 * The last plan-mode state and the last review baseline per plan on the branch.
 * One pass, because reading the branch walks the whole session.
 */
function readBranchState(ctx: ExtensionContext): BranchState {
	let mode: PlanModeEntry | undefined;
	const baselines = new Map<string, SectionDigest[]>();
	const seeded = new Map<string, string[]>();
	for (const raw of ctx.sessionManager.getBranch()) {
		const entry = raw as { type?: string; customType?: string; data?: unknown };
		if (entry.type !== "custom") continue;
		if (entry.customType === STATE_TYPE) {
			const data = entry.data as { enabled?: unknown; removed?: unknown } | null | undefined;
			if (typeof data?.enabled !== "boolean") continue;
			// Branch data is untrusted; keep only string tool names.
			const removed = Array.isArray(data.removed)
				? data.removed.filter((name): name is string => typeof name === "string")
				: undefined;
			mode = removed ? { enabled: data.enabled, removed } : { enabled: data.enabled };
			continue;
		}
		if (entry.customType === SEEDED_TYPE) {
			const data = entry.data as { path?: unknown; steps?: unknown } | null | undefined;
			if (typeof data?.path !== "string" || !Array.isArray(data.steps)) continue;
			// Branch data is untrusted: keep only the strings a step can be.
			seeded.set(
				resolve(data.path),
				data.steps.filter((text): text is string => typeof text === "string"),
			);
			continue;
		}
		if (entry.customType !== BASELINE_TYPE) continue;
		const data = entry.data as { path?: unknown; sections?: unknown } | null | undefined;
		if (typeof data?.path !== "string") continue;
		const sections = readSections(data.sections);
		// Last entry per path wins, the same rule the mode entry follows. The key is
		// canonical, so a path recorded on another platform or relative to another cwd
		// still answers a lookup for the plan it names.
		if (sections) baselines.set(resolve(data.path), sections);
	}
	return { mode, baselines, seeded };
}

/** Compare two paths, resolving symlinks when possible so `/tmp` and `/private/tmp` match. */
function samePath(a: string, b: string): boolean {
	const normalize = (path: string): string => {
		try {
			return realpathSync(path);
		} catch {
			return resolve(path);
		}
	};
	return normalize(a) === normalize(b);
}

/** One terminal-safe line for the footer chip. */
function statusName(path: string): string {
	const name = sanitizeLine(basename(path).replace(/\.md$/i, ""));
	if (!name) return "plan";
	return truncateToWidth(name, STATUS_NAME_LENGTH, "…");
}

export function createPlanRuntime(
	pi: ExtensionAPI,
	policy: ReadOnlyPolicy,
	options: { entryPath?: string } = {},
): PlanRuntime {
	let enabled = false;
	let lastPlanPath: string | undefined;
	// The section digests each plan path last showed in a review, so the next review
	// can mark what changed. Persisted with the branch, so `/resume` and `/tree`
	// compare against the review this branch actually showed.
	const reviewedPlans = new Map<string, SectionDigest[]>();
	/** The steps each approval appended, so the next approval can replace its own leftovers. */
	const seededPlans = new Map<string, string[]>();
	// Tools plan mode deactivated, so disabling restores exactly those and does
	// not re-activate a tool another extension intentionally hid.
	let removedForPlan: string[] = [];
	// Mode tools this enable had to activate, so disabling puts the user's own
	// active set back instead of widening it.
	let addedForPlan: string[] = [];

	const plans = createPlanStore(pi);

	/**
	 * Whether `toolName` is plan's own registration, matched by the entry path the
	 * host recorded. Older hosts may not record a source; only a recorded mismatch
	 * is rejected.
	 */
	const isOwnTool = (toolName: string): boolean => {
		if (toolName !== PLAN_TOOL) return false;
		const info = pi.getAllTools().find((tool) => tool.name === toolName);
		const source = info?.sourceInfo?.path;
		return source === undefined || options.entryPath === undefined || samePath(source, options.entryPath);
	};

	/** Tools plan mode would hide from the current active set. */
	const captureHidden = (): string[] => [
		...new Set(pi.getActiveTools().filter((name) => !policy.isAllowed(name) && !MODE_TOOLS.includes(name))),
	];

	/**
	 * Apply the current mode to the active set. `addHidden` re-adds the tools a
	 * user disable hid; a branch restore passes false, because the host has
	 * already put the target branch's base tools back.
	 */
	const applyTools = (addHidden: boolean): void => {
		const active = pi.getActiveTools();
		if (enabled) {
			// Keep only tools the policy considers safe to expose while read-only
			// (structured readers and the plan/goal trackers), plus the `plan` tool
			// itself, whose actions are the mode's own vocabulary.
			addedForPlan = MODE_TOOLS.filter((name) => !active.includes(name));
			pi.setActiveTools([...new Set([...active.filter((name) => policy.isAllowed(name)), ...MODE_TOOLS])]);
			return;
		}
		// A mode tool this enable had to activate goes back to how the user left it,
		// rather than staying active because the mode needed it for a while.
		const kept = active.filter((name) => !addedForPlan.includes(name));
		addedForPlan = [];
		const restored = addHidden ? removedForPlan : [];
		pi.setActiveTools([...new Set([...kept, ...restored])]);
		removedForPlan = [];
	};

	const statusText = (): string =>
		lastPlanPath ? `${GLYPHS.plan} plan · ${statusName(lastPlanPath)}` : `${GLYPHS.plan} plan`;

	const setStatus = (ctx: ExtensionContext): void => {
		// Published unstyled: the chip's text is what a footer without bytefly shows, and
		// bytefly's mode segment paints the mode by role instead of reading this pill.
		ctx.ui.setStatus(STATUS_KEYS.planMode, enabled ? statusText() : undefined);
	};

	const setEnabled = (next: boolean, ctx: ExtensionContext | undefined, persist: boolean): void => {
		const changed = next !== enabled;
		// Capture what we hide only when entering plan mode from a non-plan set.
		// A redundant enable (for example a `session_tree` restore while already
		// enabled) must not recompute this from the already-filtered active set, or
		// disabling would lose them.
		if (changed && next) removedForPlan = captureHidden();
		enabled = next;
		applyTools(!next);
		if (persist && changed) {
			pi.appendEntry(STATE_TYPE, (next ? { enabled, removed: removedForPlan } : { enabled }) satisfies PlanModeEntry);
		}
		if (ctx) setStatus(ctx);
	};

	return {
		isEnabled: () => enabled,
		enable: (ctx) => setEnabled(true, ctx, true),
		disable: (ctx) => setEnabled(false, ctx, true),
		toggle: (ctx) => setEnabled(!enabled, ctx, true),
		restore: (ctx) => {
			lastPlanPath = undefined;
			const branch = readBranchState(ctx);
			// The baseline belongs to the branch that was reviewed: a plan this branch
			// never showed has no digest here, so nothing looks changed until it does.
			reviewedPlans.clear();
			for (const [path, sections] of branch.baselines) reviewedPlans.set(path, sections);
			seededPlans.clear();
			for (const [path, steps] of branch.seeded) seededPlans.set(path, steps);
			const persisted = branch.mode;
			// `--plan` starts a fresh session in plan mode; an explicit persisted
			// choice (including a later disable) wins over the launch flag.
			const fromFlag = persisted === undefined && pi.getFlag("plan") === true;
			const next = fromFlag || persisted?.enabled === true;
			// A branch carries the tools it hid, so adopt them for a later disable;
			// a fresh `--plan` captures the current set instead.
			if (next && persisted?.removed !== undefined) removedForPlan = [...persisted.removed];
			else if (next) removedForPlan = captureHidden();
			else removedForPlan = [];
			enabled = next;
			// Never re-add hidden tools on restore: the host has already restored the
			// target branch's base set, and only a user disable should undo our hide.
			applyTools(false);
			if (ctx) setStatus(ctx);
		},
		plans,
		isOwnTool,
		lastPlanPath: () => lastPlanPath,
		setLastPlan: (ctx, path) => {
			lastPlanPath = path;
			setStatus(ctx);
		},
		reviewed: (path) => reviewedPlans.get(resolve(path)),
		seeded: (path) => seededPlans.get(resolve(path)),
		markSeeded: (path, steps) => {
			const key = resolve(path);
			seededPlans.set(key, [...steps]);
			pi.appendEntry(SEEDED_TYPE, { path: key, steps: [...steps] } satisfies SeededStepsEntry);
		},
		markReviewed: (path, content) => {
			const key = resolve(path);
			const sections = sectionDigests(content);
			const previous = reviewedPlans.get(key);
			// A screen shown again over the same content must not grow the branch.
			if (previous && sameSections(previous, sections)) return;
			reviewedPlans.set(key, sections);
			pi.appendEntry(BASELINE_TYPE, { path: key, sections } satisfies ReviewBaselineEntry);
		},
	};
}
