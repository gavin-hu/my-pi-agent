/**
 * Cross-extension ordering for the above-editor "rail" widgets.
 *
 * Pi renders above-editor extension widgets in insertion order and re-inserts a
 * widget every time it is set (`InteractiveMode.setExtensionWidget`), so the
 * widget updated most recently sinks to the bottom. There is no order option.
 *
 * The rails are meant to read as one family: `goal` (the *what*) above `todo`
 * (the *how*). A goal update would otherwise re-append the goal below the list.
 * To keep the order stable, the lower rail re-asserts itself whenever a rail
 * above it changes: re-insertion always appends, so re-asserting pins it to the
 * bottom. A rail that re-asserts must **not** announce, or two rails would
 * ping-pong; only the rails above announce.
 *
 * Extensions load with isolated module caches, so this module is value-only:
 * constants and pure helpers that operate on the caller's `pi.events` bus.
 * Never keep shared state here.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** EventBus channel: a rail above the re-asserting widget changed. */
export const RAILS_CHANGED_CHANNEL = "my-pi-agent/rails-changed";

/** Announce that a rail widget was set. Call after `ctx.ui.setWidget(...)`. */
export function announceRailChanged(pi: Pick<ExtensionAPI, "events">): void {
	pi.events.emit(RAILS_CHANGED_CHANNEL, undefined);
}

/** Run `handler` whenever a rail above announces a change; returns an unsubscribe. */
export function onRailChanged(pi: Pick<ExtensionAPI, "events">, handler: () => void): () => void {
	return pi.events.on(RAILS_CHANGED_CHANNEL, () => handler());
}
