import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CheckpointListComponent, type CheckpointAction, type CheckpointListOptions } from "../../extensions/checkpoint/tui.ts";
import type { Checkpoint } from "../../extensions/checkpoint/types.ts";

/** A theme double whose `fg` is the identity, so text stays assertable. */
const theme: any = { fg: (_color: string, text: string) => text };

/** Let an immediately-resolved stats promise settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
	return {
		id: "abc",
		ref: "refs/pi/checkpoints/abc",
		commit: "deadbeef",
		reason: "auto",
		timestamp: 1000,
		root: "/repo",
		head: "deadbeef",
		clean: false,
		includeUntracked: true,
		...overrides,
	};
}

const checkpoints: Checkpoint[] = [
	makeCheckpoint({ id: "c1", prompt: "fix the list" }),
	makeCheckpoint({ id: "c2", reason: "pre-restore" }),
	makeCheckpoint({ id: "c3", reason: "manual", label: "before refactor" }),
];

/** Construct with the shared defaults. */
function makeComponent(overrides: Partial<CheckpointListOptions> = {}): CheckpointListComponent {
	return new CheckpointListComponent({
		checkpoints,
		theme,
		onClose: () => {},
		requestRender: () => {},
		...overrides,
	});
}

describe("CheckpointListComponent", () => {
	test("renders an empty-state hint", () => {
		const lines = makeComponent({ checkpoints: [] }).render(60);
		expect(lines.join("\n")).toContain("No checkpoints yet");
	});

	test("closes with no action on Escape", () => {
		let closed: CheckpointAction | undefined | "called" = "called";
		const component = makeComponent({ onClose: (action: CheckpointAction | undefined) => (closed = action) });
		component.handleInput("\u001b");
		expect(closed).toBeUndefined();
	});

	test("renders the friendly label without the raw id", () => {
		const body = makeComponent().render(60).join("\n");
		expect(body).toContain('"fix the list"');
		expect(body).toContain("before restore");
		expect(body).toContain("before refactor");
		expect(body).not.toContain("#c1");
	});

	test("keeps the header border within the width", () => {
		const lines = makeComponent().render(40);
		expect(visibleWidth(lines[0])).toBe(40);
	});

	test("never exceeds the available width", () => {
		const wide = [makeCheckpoint({ prompt: "x".repeat(300) })];
		const lines = makeComponent({ checkpoints: wide }).render(24);
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(24);
	});

	test("sizes the window to the terminal height", () => {
		const many: Checkpoint[] = Array.from({ length: 30 }, (_, i) =>
			makeCheckpoint({ id: `c${i}`, prompt: `prompt ${i}` }),
		);

		const short = makeComponent({ checkpoints: many, viewportRows: 15 }).render(60).join("\n");
		expect(short).toContain("showing 1–6 of 30");
		expect(short).not.toContain("prompt 6");

		const tall = makeComponent({ checkpoints: many, viewportRows: 60 }).render(60).join("\n");
		expect(tall).toContain("prompt 29");
		expect(tall).not.toContain("showing");
	});

	test("drops the title instead of ellipsizing the border when very narrow", () => {
		const lines = makeComponent().render(6);
		expect(visibleWidth(lines[0])).toBe(6);
		expect(lines[0]).not.toContain("...");
	});

	test("windows long lists and scrolls as the cursor moves", () => {
		const many: Checkpoint[] = Array.from({ length: 30 }, (_, i) =>
			makeCheckpoint({ id: `c${i}`, prompt: `prompt ${i}` }),
		);
		let renders = 0;
		const component = makeComponent({ checkpoints: many, requestRender: () => renders++ });

		const first = component.render(60).join("\n");
		expect(first).toContain('"prompt 0"');
		expect(first).not.toContain("prompt 12");
		expect(first).toContain("showing 1–12 of 30");

		component.handleInput("\u001b[B"); // down: cursor moves, window stays
		expect(renders).toBe(1);
		expect(component.render(60).join("\n")).toContain("showing 1–12 of 30");

		component.handleInput("\u001b[6~"); // page down: window shifts
		expect(component.render(60).join("\n")).toContain("showing 3–14 of 30");

		component.handleInput("\u001b[F"); // end
		expect(component.render(60).join("\n")).toContain("showing 19–30 of 30");
	});

	test("Enter restores the selected checkpoint", () => {
		const choices: CheckpointAction[] = [];
		const component = makeComponent({ onClose: (action?: CheckpointAction) => action && choices.push(action) });

		component.handleInput("\u001b[B"); // down to c2
		component.handleInput("\r"); // Enter
		expect(choices).toEqual([{ action: "restore", checkpoint: checkpoints[1] }]);
	});

	test("d resolves a diff for the selected checkpoint", () => {
		const choices: CheckpointAction[] = [];
		const component = makeComponent({ onClose: (action?: CheckpointAction) => action && choices.push(action) });

		component.handleInput("d");
		expect(choices).toEqual([{ action: "diff", checkpoint: checkpoints[0] }]);
	});

	test("s and c resolve save and clear intents", () => {
		const choices: CheckpointAction[] = [];
		const component = makeComponent({ onClose: (action?: CheckpointAction) => action && choices.push(action) });

		component.handleInput("s");
		component.handleInput("c");
		expect(choices).toEqual([{ action: "save" }, { action: "clear" }]);
	});

	test("the wheel moves the selection", () => {
		const component = makeComponent();
		component.render(60);
		expect(component.handleMouse({ type: "wheel", wheelDelta: 1 } as any)).toEqual({ handled: true });
		const selected = component.render(60).find((line) => line.startsWith("❯"));
		expect(selected).toContain("before restore");
		expect(component.handleMouse({ type: "click", button: "left" } as any)).toBeUndefined();
	});

	test("loads stats once per focused checkpoint and renders them", async () => {
		const loads: string[] = [];
		const component = makeComponent({
			loadStats: async (checkpoint: Checkpoint) => {
				loads.push(checkpoint.id);
				return { changed: 1, removed: 0 };
			},
		});

		await flush();
		expect(loads).toEqual(["c1"]);
		expect(component.render(60).join("\n")).toContain("1 file changed");

		component.handleInput("\u001b[B"); // down to c2
		await flush();
		expect(loads).toEqual(["c1", "c2"]);

		component.handleInput("\u001b[B"); // down to c3
		component.handleInput("\u001b[A"); // back up to c2 (cached)
		await flush();
		expect(loads).toEqual(["c1", "c2", "c3"]);
	});

	test("shows why a preview failed", async () => {
		const component = makeComponent({
			loadStats: async () => {
				throw new Error("a git merge is in progress");
			},
		});
		await flush();
		expect(component.render(60).join("\n")).toContain("can't preview: a git merge is in progress");
	});

	test("ignores a late stats result after dispose", async () => {
		let resolveStats: (value: { changed: number; removed: number }) => void = () => {};
		let renders = 0;
		const component = makeComponent({
			requestRender: () => renders++,
			loadStats: () =>
				new Promise<{ changed: number; removed: number }>((resolve) => {
					resolveStats = resolve;
				}),
		});
		component.dispose();
		resolveStats({ changed: 2, removed: 0 });
		await flush();
		expect(renders).toBe(0);
	});
});
