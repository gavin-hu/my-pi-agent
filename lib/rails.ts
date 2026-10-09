/**
 * Cross-extension ordering for the above-editor "rail" widgets.
 *
 * Pi renders above-editor extension widgets in insertion order and re-inserts a
 * widget every time it is set (`InteractiveMode.setExtensionWidget`), so the
 * widget updated most recently sinks to the bottom. There is no order option.
 *
 * The rails are meant to read as one family, top to bottom: `goal` (the *what*),
 * then `todo` (the *how*). To keep that order stable, each rail re-asserts
 * itself whenever a rail above it changes: re-insertion always appends, so
 * re-asserting pins the rail to the bottom of the stack. A rail that re-asserts
 * must announce in turn if another rail sits below it, or only the rails it can
 * see would follow. The chain is therefore:
 *
 *   goal  → announces only (top rail)
 *   todo  → re-asserts on goal (bottom rail)
 *
 * A rail only ever subscribes to rails strictly above it, so the chain can
 * never ping-pong back up. Subscribing to *all* uppers (not just the immediate
 * one) keeps the order correct when a middle extension is not loaded.
 *
 * Extensions load with isolated module caches, so this module is value-only:
 * constants and pure helpers that operate on the caller's `pi.events` bus.
 * Never keep shared state here.
 *
 * The same bus carries dock-screen suppression. Pi mounts a `ctx.ui.custom`
 * screen in the dock's editor slot, which shares the terminal with the rails,
 * so a screen that wants the rails out of the way emits open/close and each
 * rail hides until the last screen closes. See `withRailsSuppressed`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Rails in render order, top to bottom. */
const RAIL_ORDER = ["goal", "todo"] as const;

/** Identifier for one above-editor rail. */
type RailId = (typeof RAIL_ORDER)[number];

/** EventBus channel: the rail at `id` just re-set its widget. */
function channel(id: RailId): string {
	return `my-pi-agent/rails-changed/${id}`;
}

/** Announce that the rail at `id` changed. Call after `ctx.ui.setWidget(...)`. */
export function announceRailChanged(pi: Pick<ExtensionAPI, "events">, id: RailId): void {
	pi.events.emit(channel(id), undefined);
}

/** Run `handler` whenever any rail above `id` announces; returns an unsubscribe. */
export function onUpperRailChanged(pi: Pick<ExtensionAPI, "events">, id: RailId, handler: () => void): () => void {
	const upper = RAIL_ORDER.slice(0, RAIL_ORDER.indexOf(id));
	const unsubs = upper.map((rail) => pi.events.on(channel(rail), () => handler()));
	return () => {
		for (const unsub of unsubs) unsub();
	};
}

/** EventBus channel: a dock screen opened (true) or closed (false). */
const SCREEN_CHANNEL = "my-pi-agent/rails-screen";

/** Tell the rails whether a dock screen is open. */
function setRailsSuppressed(pi: Pick<ExtensionAPI, "events">, suppressed: boolean): void {
	pi.events.emit(SCREEN_CHANNEL, suppressed);
}

/** Run an async dock screen with every rail hidden; always restores afterwards. */
export async function withRailsSuppressed<T>(pi: Pick<ExtensionAPI, "events">, fn: () => Promise<T>): Promise<T> {
	setRailsSuppressed(pi, true);
	try {
		return await fn();
	} finally {
		setRailsSuppressed(pi, false);
	}
}

/**
 * Subscribe to suppression. The depth counter lives in this closure (never
 * module state), so nested open/close pairs keep `suppressed` true until the
 * last screen closes.
 */
export function onRailsSuppressed(
	pi: Pick<ExtensionAPI, "events">,
	onChange: (suppressed: boolean) => void,
): () => void {
	let depth = 0;
	return pi.events.on(SCREEN_CHANNEL, (data) => {
		depth = Math.max(0, depth + (data === true ? 1 : -1));
		onChange(depth > 0);
	});
}
