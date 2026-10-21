/**
 * Mounting a polled dock screen: the rails, the tick, and the teardown.
 *
 * The host is doubled through `fakeCtx`, whose `ui.custom` is replaced here by
 * one that calls the mount factory at once and resolves when the screen closes —
 * the same contract the real host gives. The timer is injected, so no case waits.
 */

import { describe, expect, test } from "bun:test";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { onRailsSuppressed } from "./rails.ts";
import { withPolledScreen, type PolledScreen } from "./screen-session.ts";
import type { RepeatTimer } from "./timer.ts";
import { fakeCtx } from "../test/helpers/context.ts";
import { fakeTheme, makeFakePi } from "../test/helpers/fakes.ts";

/** A screen with nothing to draw: the handle behaviour is what is under test. */
class Screen implements Component {
	invalidate(): void {}

	render(): string[] {
		return ["screen"];
	}
}

interface Harness {
	pi: ReturnType<typeof makeFakePi>["pi"];
	ctx: ReturnType<typeof fakeCtx>["ctx"];
	/** Rails suppression transitions, in order. */
	suppressed: boolean[];
	/** Each arm the helper made, so a test can fire the tick by hand. */
	timers: Array<{ ms: number; tick: () => void }>;
	cancels(): number;
	renders(): number;
	/** Record one cancel of the injected timer. */
	noteCancel(): void;
	/** The component the host mounted, once the helper reached it. */
	mounted(): Component | undefined;
	/** Close the screen, as its own close key would. */
	close(): void;
}

function harness(): Harness {
	const { pi } = makeFakePi();
	const { ctx } = fakeCtx();
	const suppressed: boolean[] = [];
	onRailsSuppressed(pi, (value) => suppressed.push(value));

	let renders = 0;
	let cancels = 0;
	let component: Component | undefined;
	let done: (() => void) | undefined;
	const timers: Array<{ ms: number; tick: () => void }> = [];
	const tui = {
		requestRender: () => (renders += 1),
		terminal: { rows: 24 },
	} as unknown as TUI;

	ctx.ui.custom = (mount: (tui: TUI, theme: unknown, keys: unknown, close: () => void) => Component) =>
		new Promise<void>((resolve, reject) => {
			done = () => resolve();
			try {
				component = mount(tui, fakeTheme, {}, done);
			} catch (error) {
				reject(error);
			}
		});

	return {
		pi,
		ctx,
		suppressed,
		timers,
		cancels: () => cancels,
		renders: () => renders,
		noteCancel: () => {
			cancels += 1;
		},
		mounted: () => component,
		close: () => done?.(),
	};
}

/** A timer seam that records each arm and counts its cancels. */
function recordingTimer(harnessed: Harness): RepeatTimer {
	return (ms, tick) => {
		harnessed.timers.push({ ms, tick });
		return () => harnessed.noteCancel();
	};
}

describe("withPolledScreen", () => {
	test("hides the rails for the mount and restores them when it closes", async () => {
		const h = harness();
		const running = withPolledScreen(h.pi, h.ctx, () => new Screen(), {
			pollMs: 10,
			poll: () => {},
			timer: recordingTimer(h),
		});
		expect(h.suppressed).toEqual([true]);
		h.close();
		await running;
		expect(h.suppressed).toEqual([true, false]);
	});

	test("arms one tick that polls with the mounted component, and cancels it on close", async () => {
		const h = harness();
		const polls: Component[] = [];
		const running = withPolledScreen(h.pi, h.ctx, () => new Screen(), {
			pollMs: 25,
			poll: (screen) => polls.push(screen),
			timer: recordingTimer(h),
		});
		expect(h.timers).toHaveLength(1);
		expect(h.timers[0]?.ms).toBe(25);
		h.timers[0]?.tick();
		expect(polls).toEqual([h.mounted() as Component]);
		expect(h.cancels()).toBe(0);
		h.close();
		await running;
		expect(h.cancels()).toBe(1);
	});

	test("hands the screen the host's handles", async () => {
		const h = harness();
		let seen: PolledScreen | undefined;
		const running = withPolledScreen(
			h.pi,
			h.ctx,
			(screen) => {
				seen = screen;
				screen.requestRender();
				return new Screen();
			},
			{ pollMs: 10, poll: () => {}, timer: recordingTimer(h) },
		);
		h.close();
		await running;
		expect(seen?.theme).toBe(fakeTheme);
		expect(seen?.viewportRows()).toBe(24);
		expect(seen?.tui).toBeDefined();
		expect(h.renders()).toBe(1);
	});

	test("cancels the tick and restores the rails when the mount throws", async () => {
		const h = harness();
		const running = withPolledScreen(
			h.pi,
			h.ctx,
			() => {
				throw new Error("the screen could not mount");
			},
			{ pollMs: 10, poll: () => {}, timer: recordingTimer(h) },
		);
		await expect(running).rejects.toThrow("the screen could not mount");
		expect(h.suppressed).toEqual([true, false]);
		// The tick is armed after the mount, so a screen that never mounted leaves none.
		expect(h.timers).toHaveLength(0);
		expect(h.cancels()).toBe(0);
	});
});
