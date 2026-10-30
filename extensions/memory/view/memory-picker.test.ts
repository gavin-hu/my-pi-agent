import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createFakePi, fakeTheme as theme } from "../../../test/helpers/fakes.ts";
import { settle } from "../../../test/helpers/process.ts";
import type { MemoryEntries } from "../format.ts";
import { createMemoryRuntime } from "../runtime.ts";
import { type MemoryPickerCallbacks, MemoryPickerComponent } from "./memory-picker.ts";
import { registerTools, TOOL_NAME } from "../tools.ts";

const tui = { requestRender: () => {}, terminal: { rows: 24, columns: 80 } } as any;

interface RecordedCalls {
	add: Array<[string, string]>;
	update: Array<[string, string, string]>;
	forget: Array<[string, string]>;
	merge: Array<[string, string, string, string]>;
	move: Array<[string, string, string]>;
	refresh: number;
}

/** In-memory store double with the same match semantics as the runtime. */
function makeCallbacks(initial: MemoryEntries, trusted = true, overrides: Partial<MemoryPickerCallbacks> = {}) {
	const entries: MemoryEntries = { project: [...initial.project], global: [...initial.global] };
	const calls: RecordedCalls = { add: [], update: [], forget: [], merge: [], move: [], refresh: 0 };
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
		move: async (from, to, entry) => {
			const source = entries[from];
			const at = source.indexOf(entry);
			if (at < 0) throw new Error(`No ${from} memory note matches.`);
			source.splice(at, 1);
			const existing = entries[to].includes(entry) ? entry : undefined;
			if (!existing) entries[to].push(entry);
			calls.move.push([from, to, entry]);
			return existing === undefined ? { moved: true } : { moved: true, existing };
		},
		merge: async (scope, first, second, merged) => {
			const list = entries[scope];
			const firstAt = list.indexOf(first);
			const secondAt = list.indexOf(second);
			if (firstAt < 0 || secondAt < 0) throw new Error(`No ${scope} memory note matches.`);
			list[firstAt] = merged;
			list.splice(secondAt, 1);
			calls.merge.push([scope, first, second, merged]);
			return true;
		},
	};
	return { callbacks: { ...callbacks, ...overrides }, calls, entries };
}

function harness(initial: MemoryEntries, trusted = true, overrides: Partial<MemoryPickerCallbacks> = {}) {
	const { callbacks, calls, entries } = makeCallbacks(initial, trusted, overrides);
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

/** The registered tool, with a runtime that never touches disk during rendering. */
function memoryTool() {
	const fake = createFakePi();
	registerTools(fake.pi, createMemoryRuntime(fake.pi));
	return fake.tools.get(TOOL_NAME);
}

describe("memory result rendering", () => {
	test("sanitizes a rejected call's error text", () => {
		const result = {
			content: [{ type: "text", text: "" }],
			details: {
				action: "list",
				scope: "project",
				project: [],
				global: [],
				changed: false,
				error: "bad\u001b[31mtext",
			},
		};
		const text = memoryTool()
			.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).toContain("bad");
		expect(text).not.toContain("\u001b");
	});
});

describe("MemoryPickerComponent render", () => {
	test("shows an empty state", () => {
		expect(harness({ project: [], global: [] }).text()).toContain("No notes yet");
	});

	test("lists project then global notes with a scope tag and selection marker", () => {
		const text = harness({ project: ["repo fact"], global: ["global fact"] }).text();
		expect(text).toContain("❯ project · repo fact");
		expect(text).toContain("global · global fact");
	});

	test("stays within the width while a merge is marked and in the merge editor", () => {
		for (const width of [80, 40, 20, 12, 6]) {
			const marked = harness({ project: ["Use bun", "Use bun for tests"], global: [] });
			marked.input("m");
			for (const line of marked.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			marked.input("j");
			marked.input("m");
			for (const line of marked.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
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

	test("g and G jump to the first and last note", () => {
		const h = harness({ project: ["a", "b", "c"], global: ["d"] });
		h.input("G");
		expect(h.text()).toContain("❯ global · d");
		h.input("g");
		expect(h.text()).toContain("❯ project · a");
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

describe("MemoryPickerComponent merge", () => {
	test("merges two marked notes through the pre-filled editor", async () => {
		const h = harness({ project: ["Use bun", "Use bun for tests"], global: [] });
		h.input("m");
		expect(h.text()).toContain("merge");
		h.input("j");
		h.input("m");
		expect(h.text()).toContain("Memory · Merge project");
		h.input("\r");
		await settle();
		expect(h.calls.merge).toEqual([["project", "Use bun", "Use bun for tests", "Use bun; Use bun for tests"]]);
		expect(h.entries.project).toEqual(["Use bun; Use bun for tests"]);
		expect(h.text()).toContain("Merged 2 project notes.");
	});

	test("lets the merged wording be edited before it is saved", async () => {
		const h = harness({ project: ["Use bun", "Use bun for tests"], global: [] });
		h.input("m");
		h.input("j");
		h.input("m");
		for (let index = 0; index < 40; index++) h.input("\x7f");
		h.input("Run tests with bun");
		h.input("\r");
		await settle();
		expect(h.calls.merge).toEqual([["project", "Use bun", "Use bun for tests", "Run tests with bun"]]);
		expect(h.entries.project).toEqual(["Run tests with bun"]);
	});

	test("refuses a pair in different scopes and keeps the mark", () => {
		const h = harness({ project: ["repo fact"], global: ["global fact"] });
		h.input("m");
		h.input("j");
		h.input("j");
		h.input("m");
		expect(h.calls.merge).toEqual([]);
		expect(h.text()).toContain("same scope");
		expect(h.text()).toContain("merge");
	});

	test("unmarks on a second m over the same note, and Esc clears the mark first", () => {
		const h = harness({ project: ["one"], global: [] });
		h.input("m");
		h.input("m");
		h.input("\x1b");
		expect(h.closeCount()).toBe(1);
		h.input("m");
		h.input("\x1b");
		expect(h.closeCount()).toBe(1);
		expect(h.text()).not.toContain("Esc cancel merge");
	});

	test("cancelling the merge editor writes nothing", () => {
		const h = harness({ project: ["one", "two"], global: [] });
		h.input("m");
		h.input("j");
		h.input("m");
		h.input("\x1b");
		expect(h.calls.merge).toEqual([]);
		expect(h.entries.project).toEqual(["one", "two"]);
	});

	test("clears the mark when the marked note is forgotten", async () => {
		const h = harness({ project: ["keep", "gone"], global: [] });
		h.input("m");
		h.input("j");
		h.input("j");
		h.input("m"); // moves past the end, selection clamps to "gone"
		h.input("\x1b");
		h.input("j");
		h.input("d");
		h.input("y");
		await settle();
		expect(h.entries.project).toEqual(["keep"]);
		expect(h.text()).not.toContain("Esc cancel merge");
	});
});

describe("MemoryPickerComponent move", () => {
	test("p moves the focused note to the other scope and follows it", async () => {
		const h = harness({ project: ["repo fact"], global: [] });
		h.input("p");
		await settle();
		expect(h.calls.move).toEqual([["project", "global", "repo fact"]]);
		expect(h.entries.project).toEqual([]);
		expect(h.entries.global).toEqual(["repo fact"]);
		expect(h.text()).toContain("Moved to global.");
	});

	test("p on a global note moves it into the project", async () => {
		const h = harness({ project: [], global: ["global fact"] });
		h.input("p");
		await settle();
		expect(h.calls.move).toEqual([["global", "project", "global fact"]]);
		expect(h.entries.project).toEqual(["global fact"]);
		expect(h.text()).toContain("Moved to project.");
	});

	test("names the target match when the other scope already had the note", async () => {
		const h = harness({ project: ["Use bun"], global: ["Use bun"] });
		h.input("p");
		await settle();
		expect(h.text()).toContain("Moved to global (it was already there).");
		expect(h.entries.global).toEqual(["Use bun"]);
	});

	test("refuses a move into an untrusted project without writing", async () => {
		const h = harness({ project: [], global: ["global fact"] }, false);
		h.input("p");
		await settle();
		expect(h.calls.move).toEqual([]);
		expect(h.entries.global).toEqual(["global fact"]);
		expect(h.text()).toContain("Project memory is unavailable");
	});

	test("reports a failed move instead of throwing", async () => {
		const h = harness({ project: ["repo fact"], global: [] }, true, {
			move: async () => {
				throw new Error("disk full");
			},
		});
		h.input("p");
		await settle();
		expect(h.text()).toContain("Memory not saved: disk full");
		expect(h.entries.project).toEqual(["repo fact"]);
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
