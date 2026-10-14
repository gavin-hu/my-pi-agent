import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme as theme } from "../../test/helpers/fakes.ts";
import { settle } from "../../test/helpers/process.ts";
import type { MemoryEntries } from "./format.ts";
import { type MemoryPickerCallbacks, MemoryPickerComponent } from "./tui.ts";

const tui = { requestRender: () => {}, terminal: { rows: 24, columns: 80 } } as any;

interface RecordedCalls {
	add: Array<[string, string]>;
	update: Array<[string, string, string]>;
	forget: Array<[string, string]>;
	refresh: number;
}

/** In-memory store double with the same match semantics as the runtime. */
function makeCallbacks(initial: MemoryEntries, trusted = true) {
	const entries: MemoryEntries = { project: [...initial.project], global: [...initial.global] };
	const calls: RecordedCalls = { add: [], update: [], forget: [], refresh: 0 };
	const callbacks: MemoryPickerCallbacks = {
		entries: () => ({ project: [...entries.project], global: [...entries.global] }),
		trusted: () => trusted,
		refresh: () => {
			calls.refresh += 1;
			return false;
		},
		add: async (scope, text) => {
			calls.add.push([scope, text]);
			if (entries[scope].includes(text)) return { changed: false, existing: text };
			entries[scope].push(text);
			return { changed: true };
		},
		update: async (scope, from, to) => {
			const list = entries[scope];
			const at = list.indexOf(from);
			if (at < 0) throw new Error(`No ${scope} memory note matches.`);
			list[at] = to;
			calls.update.push([scope, from, to]);
			return true;
		},
		forget: async (scope, entry) => {
			const list = entries[scope];
			const at = list.indexOf(entry);
			if (at < 0) throw new Error(`No ${scope} memory note matches.`);
			list.splice(at, 1);
			calls.forget.push([scope, entry]);
			return true;
		},
	};
	return { callbacks, calls, entries };
}

function harness(initial: MemoryEntries, trusted = true) {
	const { callbacks, calls, entries } = makeCallbacks(initial, trusted);
	let closed = 0;
	const component = new MemoryPickerComponent(
		tui,
		theme,
		callbacks,
		() => {
			closed += 1;
		},
		() => {},
		() => tui.terminal?.rows,
	);
	return {
		render: (width = 70): string[] => component.render(width),
		text: (width = 70): string => component.render(width).join("\n"),
		input: (data: string): void => component.handleInput(data),
		mouse: (delta: number): unknown => component.handleMouse({ type: "wheel", wheelDelta: delta } as any),
		closeCount: () => closed,
		calls,
		entries,
	};
}

describe("MemoryPickerComponent render", () => {
	test("shows an empty state", () => {
		expect(harness({ project: [], global: [] }).text()).toContain("No notes yet");
	});

	test("lists project then global notes with a scope tag and selection marker", () => {
		const text = harness({ project: ["repo fact"], global: ["global fact"] }).text();
		expect(text).toContain("❯ project · repo fact");
		expect(text).toContain("global · global fact");
	});

	test("sanitizes note text at the boundary", () => {
		const text = harness({ project: ["bad\u001b[31mtext"], global: [] }).text();
		expect(text).toContain("bad");
		expect(text).not.toContain("\u001b");
	});

	test("never exceeds the render width", () => {
		const h = harness({ project: ["p".repeat(200)], global: ["g".repeat(200)] });
		for (const width of [80, 40, 20, 10]) {
			for (const line of h.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});
});

describe("MemoryPickerComponent navigation", () => {
	test("moves the selection with j/k and the wheel", () => {
		const h = harness({ project: ["repo fact"], global: ["global fact"] });
		h.input("j");
		expect(h.text()).toContain("❯ global · global fact");
		h.input("k");
		expect(h.text()).toContain("❯ project · repo fact");
		h.mouse(1);
		expect(h.text()).toContain("❯ global · global fact");
	});

	test("cycles the scope filter with s", () => {
		const h = harness({ project: ["repo fact"], global: ["global fact"] });
		h.input("s");
		expect(h.text()).toContain("project · repo fact");
		expect(h.text()).not.toContain("global fact");
		h.input("s");
		expect(h.text()).toContain("global · global fact");
		expect(h.text()).not.toContain("repo fact");
	});

	test("closes on Escape", () => {
		const h = harness({ project: [], global: [] });
		h.input("\x1b");
		expect(h.closeCount()).toBe(1);
	});
});

describe("MemoryPickerComponent actions", () => {
	test("edits the focused note inline", async () => {
		const h = harness({ project: ["repo fact"], global: [] });
		h.input("e");
		expect(h.text()).toContain("Edit project");
		h.input("!");
		h.input("\r");
		await settle();
		expect(h.calls.update).toEqual([["project", "repo fact", "repo fact!"]]);
		expect(h.text()).toContain("Updated project note.");
	});

	test("cancels an edit on Escape without writing", () => {
		const h = harness({ project: ["repo fact"], global: [] });
		h.input("e");
		h.input("x");
		h.input("\x1b");
		expect(h.calls.update).toEqual([]);
		expect(h.text()).toContain("repo fact");
	});

	test("adds a note to the current scope", async () => {
		const h = harness({ project: [], global: [] });
		h.input("a");
		expect(h.text()).toContain("Add project");
		h.input("new note");
		h.input("\r");
		await settle();
		expect(h.calls.add).toEqual([["project", "new note"]]);
		expect(h.entries.project).toEqual(["new note"]);
	});

	test("rejects a blank note", async () => {
		const h = harness({ project: [], global: [] });
		h.input("a");
		h.input("   ");
		h.input("\r");
		await settle();
		expect(h.calls.add).toEqual([]);
		expect(h.text()).toContain("cannot be blank");
	});

	test("reports a duplicate add instead of storing it", async () => {
		const h = harness({ project: ["Use tabs"], global: [] });
		h.input("a");
		h.input("Use tabs");
		h.input("\r");
		await settle();
		expect(h.entries.project).toEqual(["Use tabs"]);
		expect(h.text()).toContain("Already remembered: Use tabs");
	});

	test("forgets the focused note after a y/N confirm", async () => {
		const h = harness({ project: ["keep", "gone"], global: [] });
		h.input("j");
		h.input("d");
		expect(h.text()).toContain('Forget project note "gone"? y/N');
		h.input("n");
		expect(h.calls.forget).toEqual([]);
		h.input("d");
		h.input("y");
		await settle();
		expect(h.calls.forget).toEqual([["project", "gone"]]);
		expect(h.entries.project).toEqual(["keep"]);
	});

	test("reloads on r", () => {
		const h = harness({ project: [], global: [] });
		h.input("r");
		expect(h.calls.refresh).toBe(1);
		expect(h.text()).toContain("already up to date");
	});
});

describe("MemoryPickerComponent trust", () => {
	test("hides project notes and targets global when untrusted", () => {
		const h = harness({ project: ["secret"], global: ["ok"] }, false);
		expect(h.text()).not.toContain("secret");
		expect(h.text()).toContain("ok");
		expect(h.text()).toContain("project untrusted");
	});

	test("adds to global when untrusted", () => {
		const h = harness({ project: [], global: [] }, false);
		h.input("a");
		expect(h.text()).toContain("Add global");
	});

	test("skips the project scope when cycling the filter untrusted", () => {
		const h = harness({ project: [], global: ["ok"] }, false);
		h.input("s");
		expect(h.text()).toContain("global · ok");
	});
});
