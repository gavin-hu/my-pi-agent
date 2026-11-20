/**
 * A launcher a suite drives by hand: the command it was asked for, and the two ways
 * Node reports that nothing opened.
 *
 * `LauncherChild` declares the `'error'` and `'exit'` overloads, so a fake implements
 * them rather than casting an object literal; every suite that proves a page says why
 * no tab opened holds one of these instead of starting a browser.
 */

import type { BrowserCommand, Launch, LauncherChild } from "../../lib/browser.ts";

/** A child that fires nothing until the case says so. */
export class FakeChild implements LauncherChild {
	#error: ((error: Error) => void)[] = [];
	#exit: ((code: number | null, signal: NodeJS.Signals | null) => void)[] = [];

	on(event: "error", listener: (error: Error) => void): unknown;
	on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	on(
		event: "error" | "exit",
		listener: ((error: Error) => void) | ((code: number | null, signal: NodeJS.Signals | null) => void),
	): unknown {
		if (event === "error") this.#error.push(listener as (error: Error) => void);
		else this.#exit.push(listener as (code: number | null, signal: NodeJS.Signals | null) => void);
		return undefined;
	}

	/** What Node emits when the executable is not on `PATH`. */
	fail(message: string): void {
		for (const listener of this.#error) listener(new Error(message));
	}

	/** What Node emits when the launcher ran and gave up. */
	exit(code: number | null): void {
		for (const listener of this.#exit) listener(code, null);
	}
}

/** A launch that records what it was asked and answers with a child the case drives. */
export function recordingLaunch(): { launch: Launch; calls: BrowserCommand[]; child: FakeChild } {
	const calls: BrowserCommand[] = [];
	const child = new FakeChild();
	return {
		calls,
		child,
		launch: (command, args) => {
			calls.push({ command, args });
			return child;
		},
	};
}
