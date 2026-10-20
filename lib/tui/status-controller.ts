/**
 * The footer status chips two extensions publish the same way.
 *
 * A controller remembers the last context it was attached to, repaints the keys
 * it owns, clears them when its feature is disabled, and never throws: a
 * non-interactive mode has no UI, so every method no-ops or falls back to plain
 * text instead.
 *
 * The chips themselves are the caller's: it supplies the keys, the counts, and
 * the roles, so `job` and `watch` share the controller but not their vocabulary.
 * Value-only: the per-caller state lives in this closure, never in the module.
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { paint, type TuiRole } from "./tokens.ts";

/** One chip a controller publishes. */
export interface StatusChip {
	/** The `ctx.ui.setStatus` key. */
	key: string;
	/** Glyph shown before the count. */
	glyph: string;
	/** Count; `0` clears the key. */
	count: number;
	/** The design role the chip is drawn in. */
	role: TuiRole;
}

/** What a controller publishes, read fresh on every paint. */
export interface StatusControllerOptions {
	/** The keys this controller owns, cleared together when it is disabled. */
	keys: readonly string[];
	/** Whether the chips should be published at all. */
	enabled(): boolean;
	/** The chips for the current state. */
	chips(): readonly StatusChip[];
}

/** How a transient notification reads. */
export type NotifySeverity = "info" | "warning" | "error";

/** An attach/paint/clear surface for one extension's footer chips. */
export interface StatusController {
	/** Remember the live context; later calls use it when none is passed. */
	attach(ctx: ExtensionContext): void;
	/**
	 * Clear the chips and forget the context, for example on shutdown or reload.
	 *
	 * A detached controller cannot paint, so leaving a stale chip behind would
	 * misreport a feature that is gone.
	 */
	detach(): void;
	/** Republish using the attached context. */
	paint(): void;
	/** Publish the chips (and attach `ctx` when given). */
	setStatus(ctx?: ExtensionContext): void;
	/**
	 * Show a transient notification through the attached context.
	 *
	 * The chips and the alert belong to the same feature, so they share the one
	 * remembered context: without this, each caller re-mirrors it in a wrapper.
	 * A non-interactive mode has no UI, so this no-ops instead of throwing.
	 */
	notify(text: string, severity: NotifySeverity): void;
}

/** A context's theme, or `undefined` when the UI is unavailable. */
function themeOf(target: ExtensionContext): Theme | undefined {
	try {
		return target.ui.theme;
	} catch {
		return undefined;
	}
}

/** Paint in role, falling back to plain text when the theme cannot. */
function safePaint(theme: Theme | undefined, role: TuiRole, text: string): string {
	if (!theme) return text;
	try {
		return paint(theme, role, text);
	} catch {
		return text;
	}
}

/** Build a controller for one extension's pair of chips. */
export function createStatusController(options: StatusControllerOptions): StatusController {
	let ctx: ExtensionContext | undefined;

	const setStatus = (next?: ExtensionContext): void => {
		if (next) ctx = next;
		const target = ctx;
		if (!target) return;
		try {
			if (!options.enabled()) {
				for (const key of options.keys) target.ui.setStatus(key, undefined);
				return;
			}
			const theme = themeOf(target);
			for (const chip of options.chips()) {
				// A space before the count keeps the compact chrome form (`▸2`),
				// while the two chips stay separate segments in the full form.
				const text = `${chip.glyph} ${chip.count}`;
				target.ui.setStatus(chip.key, chip.count > 0 ? safePaint(theme, chip.role, text) : undefined);
			}
		} catch {
			// UI may be unavailable in non-interactive modes.
		}
	};

	const notify = (text: string, severity: NotifySeverity): void => {
		const target = ctx;
		if (!target) return;
		try {
			target.ui.notify(text, severity);
		} catch {
			// UI may be unavailable in non-interactive modes.
		}
	};

	return {
		attach: (next) => {
			ctx = next;
		},
		detach: () => {
			const target = ctx;
			ctx = undefined;
			if (!target) return;
			try {
				for (const key of options.keys) target.ui.setStatus(key, undefined);
			} catch {
				// UI is already gone during shutdown.
			}
		},
		paint: () => {
			setStatus();
		},
		setStatus,
		notify,
	};
}
