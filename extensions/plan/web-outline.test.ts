/**
 * The reader's place on the page: the outline and the scroll pass that marks it, block
 * navigation, the view filter, and the draft guard that keeps a half-written
 * comment from being lost.
 */

import { describe, expect, test } from "bun:test";
import { fakeClientDom, shippedRenderOutline } from "../../test/helpers/fixtures/plan-web.ts";
import type { ClientNode } from "../../lib/web/client-runtime.ts";
import { REVIEW_CLIENT_JS } from "./web-client.ts";
import { applyView, blockAtLine, blockElements, moveActive, setActive, WEB_BLOCKS_JS } from "./web-blocks.ts";
import { draftTextarea, guardDraft, WEB_DRAFT_JS } from "./web-draft.ts";
import { renderFacts, sectionFor, watchSections, WEB_OUTLINE_JS } from "./web-outline.ts";

describe("review outline", () => {
	const entries = [
		{ id: "s-1", level: 1, line: 1, text: "Goal" },
		{ id: "s-8", level: 2, line: 8, text: "Steps", changed: true },
		{ id: "s-20", level: 1, line: 20, text: "Risks" },
	];

	test("names the section a line belongs to, and none above the first", () => {
		expect(sectionFor(entries, 1)?.id).toBe("s-1");
		expect(sectionFor(entries, 7)?.id).toBe("s-1");
		expect(sectionFor(entries, 8)?.id).toBe("s-8");
		expect(sectionFor(entries, 19)?.id).toBe("s-8");
		expect(sectionFor(entries, 400)?.id).toBe("s-20");
		expect(sectionFor(entries, 0)).toBeNull();
		expect(sectionFor([], 4)).toBeNull();
	});

	test("carries the source, safe to splice into the client bundle", () => {
		expect(WEB_OUTLINE_JS.split(String(sectionFor)).length).toBe(2);
		// The page hands the list its arrival hook, because a link scrolls the pane and leaves the
		// keyboard behind; the fragment must also build with no hook beside it, which it allows.
		expect(REVIEW_CLIENT_JS).toContain("focusSection(planEl, id)");
		expect(() => new Function("el", WEB_OUTLINE_JS)(fakeClientDom().build)).not.toThrow();
	});

	test("marks the section the reading line is in on install, and on every scroll after it", () => {
		// The pass is the page's own rule for "which section am I in": the last heading whose top is
		// at or above the top two-fifths of the pane, read again each time it scrolls. A frame is
		// scheduled rather than run, so this queue is the throttle.
		const queue: Array<() => void> = [];
		const frames = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
		const before = [frames.requestAnimationFrame, frames.cancelAnimationFrame];
		frames.requestAnimationFrame = (callback: () => void) => queue.push(callback);
		frames.cancelAnimationFrame = (handle: number) => queue.splice(handle - 1, 1);
		const flush = () => queue.splice(0).forEach((callback) => callback());
		try {
			const link = (id: string) => {
				const attributes: Record<string, string | undefined> = { "data-id": id };
				return {
					id,
					getAttribute: (name: string) => attributes[name] ?? null,
					setAttribute: (name: string, value: string) => (attributes[name] = value),
					removeAttribute: (name: string) => delete attributes[name],
				};
			};
			const links = [link("s-1"), link("s-8"), link("s-20")];
			const marks = () => links.filter((node) => node.getAttribute("aria-current") === "true").map((node) => node.id);
			// The headings' tops move under the pane, which is what a scroll is from this side.
			const tops = [0, 40, 80];
			const headings = links.map((_link, index) => ({
				id: links[index]?.id ?? "",
				getBoundingClientRect: () => ({ top: tops[index] ?? 0 }),
			}));
			const listeners: Array<() => void> = [];
			const pane = {
				clientHeight: 100,
				getBoundingClientRect: () => ({ top: 0 }),
				addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
				removeEventListener: (_type: string, listener: () => void) => listeners.splice(listeners.indexOf(listener), 1),
			};
			const list = { querySelectorAll: () => links } as unknown as Parameters<typeof watchSections>[1];
			const planEl = { ...pane, querySelectorAll: () => headings } as unknown as Parameters<typeof watchSections>[0];

			// The line is 40 of the pane's 100, and a heading exactly on it counts: `s-8`.
			const watch = watchSections(planEl, list, null);
			expect(marks()).toEqual(["s-8"]);

			// End or a dragged scrollbar: one write, one frame, marked at the position it ended at.
			tops.splice(0, 3, -400, -300, -20);
			listeners[0]?.();
			listeners[0]?.();
			expect(queue).toHaveLength(1);
			flush();
			expect(marks()).toEqual(["s-20"]);

			// Every heading below the line marks nothing, rather than leaving one marked.
			tops.splice(0, 3, 60, 90, 200);
			listeners[0]?.();
			flush();
			expect(marks()).toEqual([]);

			// A repaint replaces the watch: the old listener goes and its queued frame is dropped.
			tops.splice(0, 3, 0, 40, 80);
			listeners[0]?.();
			expect(watchSections(planEl, list, watch)).not.toBeNull();
			expect(queue).toHaveLength(0);
			expect(marks()).toEqual(["s-8"]);
			expect(listeners).toHaveLength(1);

			// No headings, or no list, is no watch: the page has nothing to follow.
			const empty = { ...pane, querySelectorAll: () => [] } as unknown as Parameters<typeof watchSections>[0];
			expect(watchSections(empty, list, null)).toBeNull();
			expect(watchSections(planEl, null, null)).toBeNull();
		} finally {
			frames.requestAnimationFrame = before[0];
			frames.cancelAnimationFrame = before[1];
		}
	});

	test("paints the facts, and counts each comment under the heading above it", () => {
		// The counters are renderOutline's own output, so a comment lands in the section the
		// list was built with; one anchored above the first heading is counted in no section.
		const node = (id: string) => ({
			id,
			hidden: false,
			textContent: id === "step-count" || id === "comment-total" || id.startsWith("count-") ? "0" : null,
			style: { width: "" },
		});
		const nodes: Record<string, ReturnType<typeof node>> = {
			"step-fact": node("step-fact"),
			"step-fill": node("step-fill"),
			"step-count": node("step-count"),
			"comment-total": node("comment-total"),
			"count-1": node("count-1"),
			"count-8": node("count-8"),
		};
		nodes["step-count"]!.textContent = "0/0";
		const before = (globalThis as { document?: unknown }).document;
		(globalThis as { document?: unknown }).document = { getElementById: (id: string) => nodes[id] ?? null };
		try {
			const counters = { 1: nodes["count-1"]!, 8: nodes["count-8"]! } as unknown as Parameters<typeof renderFacts>[2];
			const entries = [
				{ id: "s-1", level: 1, line: 1, text: "Goal" },
				{ id: "s-8", level: 2, line: 8, text: "Steps" },
			];
			renderFacts(
				{ done: 2, total: 5 },
				[{ anchor: 0 }, { anchor: 4 }, { anchor: 9 }, { anchor: 12 }],
				counters,
				entries,
			);
			expect(nodes["step-fact"]?.hidden).toBe(false);
			expect(nodes["step-fill"]?.style.width).toBe("40%");
			expect(nodes["step-count"]?.textContent).toBe("2/5 ticked");
			// Four comments, three of them in a section: the one above the first heading is not.
			expect(nodes["comment-total"]?.textContent).toBe("4");
			expect(nodes["count-1"]?.textContent).toBe("1");
			expect(nodes["count-1"]?.hidden).toBe(false);
			expect(nodes["count-8"]?.textContent).toBe("2");
			expect(nodes["count-8"]?.hidden).toBe(false);

			// A plan with no Steps section shows no progress: 0/0 is noise.
			renderFacts({ done: 0, total: 0 }, [], counters, entries);
			expect(nodes["step-fact"]?.hidden).toBe(true);
			expect(nodes["count-1"]?.hidden).toBe(true);
		} finally {
			(globalThis as { document?: unknown }).document = before;
		}
	});

	test("builds one list item per heading and returns the counters it made", () => {
		// The fake builder records what it was asked for, so the assertion is about the
		// document this function describes rather than about the strings in it.
		const { made, build, renderOutline } = shippedRenderOutline();
		const counters = renderOutline(build("ul", "review-nav") as unknown as ClientNode, entries);
		expect(Object.keys(counters)).toEqual(["1", "8", "20"]);
		expect(made.filter((item) => item.tag === "li").map((item) => item.className)).toEqual(["lvl-1", "lvl-2", "lvl-1"]);
		expect(counters[8]?.hidden).toBe(true);
	});

	test("keeps the reader's section marked across a repaint", () => {
		// The page rebuilds the rail whenever the plan does, and a rebuild that dropped the mark
		// would lose "you are here" on every live frame, view switch, and name change. A heading
		// that moved has a new id, so the mark goes rather than landing on whatever is at its line.
		const { build, markedId, renderOutline } = shippedRenderOutline();
		const list = build("ul", "review-nav");
		const client = list as unknown as ClientNode;
		renderOutline(client, entries);
		expect(markedId(list)).toBe("");
		// The mark a rail click or the scroll pass made, on the link for `## Steps`.
		list.children[1]?.children[0]?.setAttribute("aria-current", "true");
		renderOutline(client, entries);
		expect(markedId(list)).toBe("s-8");
		// The same list renumbered: `s-8` is gone, so the mark is not handed to its successor.
		renderOutline(
			client,
			entries.map((item) => (item.id === "s-8" ? { ...item, id: "s-9", line: 9 } : item)),
		);
		expect(markedId(list)).toBe("");
	});
});

describe("review block navigation", () => {
	/** A block node with the two members the rules touch, recording what it was told. */
	const block = (line: number) => ({
		line,
		active: false,
		scrolled: 0,
		classList: {
			toggle(name: string, on?: boolean) {
				if (name === "bf-block--active") this.owner.active = on === true;
			},
			add() {},
			remove() {},
			owner: undefined as unknown as { active: boolean },
		},
		scrollIntoView() {
			this.scrolled += 1;
		},
		getAttribute: () => String(line),
	});
	const make = (lines: number[]) => {
		const blocks = lines.map((line) => {
			const node = block(line);
			node.classList.owner = node;
			return node;
		});
		const planEl = {
			querySelectorAll: () => blocks,
			querySelector: (selector: string) => {
				const line = Number(/data-line="(\d+)"/.exec(selector)?.[1]);
				return blocks.find((node) => node.line === line) ?? null;
			},
		};
		return { blocks, planEl: planEl as unknown as Parameters<typeof blockElements>[0] };
	};

	test("carries the source, safe to splice into the client bundle", () => {
		for (const fn of [blockElements, setActive, moveActive, blockAtLine]) {
			expect(WEB_BLOCKS_JS.split(String(fn)).length, String(fn).slice(0, 40)).toBe(2);
		}
	});

	test("an empty page has no active block, and the index it had is kept", () => {
		// `null` is the "nothing changed" answer: a caller must not be reset to zero by a
		// repaint that happened to run before the blocks were drawn.
		expect(blockElements(null)).toEqual([]);
		expect(setActive(null, 3)).toBeNull();
		expect(moveActive(null, 2, 1)).toBeNull();
	});

	test("clamps, marks one block at a time, and brings it into view", () => {
		const { blocks, planEl } = make([1, 8, 20]);
		expect(blockElements(planEl)).toHaveLength(3);
		expect(setActive(planEl, 9)).toBe(2);
		expect(blocks.map((node) => node.active)).toEqual([false, false, true]);
		expect(blocks[2]?.scrolled).toBe(1);
		expect(setActive(planEl, -4)).toBe(0);
		expect(blocks.map((node) => node.active)).toEqual([true, false, false]);
	});

	test("walks, and starts at the near end when nothing is active yet", () => {
		const { planEl } = make([1, 8, 20]);
		// Nothing active: j starts at the top, k at the bottom.
		expect(moveActive(planEl, -1, 1)).toBe(0);
		expect(moveActive(planEl, -1, -1)).toBe(2);
		// A step past the end clamps rather than wrapping: the reader asked for one more.
		expect(moveActive(planEl, 2, 1)).toBe(2);
		expect(moveActive(planEl, 0, 1)).toBe(1);
	});

	test("a filtered view is walked over, not through", () => {
		const { blocks, planEl } = make([1, 8, 20]);
		// The middle block is hidden by a view: `j` from the first lands on the third rather
		// than on a class nobody can see, and from a hidden block it steps back out.
		(blocks[1] as { hidden?: boolean }).hidden = true;
		expect(moveActive(planEl, 0, 1)).toBe(2);
		expect(moveActive(planEl, 2, -1)).toBe(0);
		expect(moveActive(planEl, 1, 1)).toBe(2);

		// Nothing visible left to walk to says so, instead of moving to a hidden block.
		(blocks[0] as { hidden?: boolean }).hidden = true;
		(blocks[2] as { hidden?: boolean }).hidden = true;
		expect(moveActive(planEl, 1, 1)).toBeNull();
	});

	test("needs both halves of a line to open a composer", () => {
		const { planEl } = make([1, 8]);
		expect(blockAtLine(planEl, [{ start: 1 }, { start: 8 }], 8)?.block.start).toBe(8);
		// Rendered but not in the island, or in the island but not rendered: neither opens.
		expect(blockAtLine(planEl, [{ start: 1 }], 8)).toBeNull();
		expect(blockAtLine(planEl, [{ start: 1 }, { start: 30 }], 30)).toBeNull();
		expect(blockAtLine(null, [{ start: 1 }], 1)).toBeNull();
	});
});

describe("review view filter", () => {
	/** A block or thread node with the members the filter reads. */
	const node = (attrs: Record<string, string>, className = "") => ({
		attrs,
		className,
		hidden: false,
		getAttribute: (name: string) => attrs[name] ?? null,
	});
	/** One page: its blocks, and the comment threads drawn under them. */
	const page = (blocks: ReturnType<typeof node>[], threads: ReturnType<typeof node>[] = []) =>
		({
			querySelectorAll: (selector: string) =>
				selector === ".bf-block" ? blocks : selector === ".bf-comments" ? threads : [],
		}) as unknown as Parameters<typeof applyView>[0];

	test("keeps the headings and what the view asks for, and hides the rest", () => {
		const blocks = [
			node({ "data-line": "0", "data-kind": "heading" }),
			node({ "data-line": "1", "data-kind": "paragraph", "data-changed": "1" }),
			node({ "data-line": "2", "data-kind": "paragraph" }),
		];
		const counts = applyView(page(blocks), "changed");
		expect(blocks.map((entry) => entry.hidden)).toEqual([false, false, true]);
		expect(counts).toEqual({ shown: 2, hidden: 1 });
	});

	test("hides a thread with its block, and leaves an orphan thread alone", () => {
		const blocks = [
			node({ "data-line": "0", "data-kind": "heading" }),
			node({ "data-line": "1", "data-kind": "paragraph", "data-changed": "1" }),
			node({ "data-line": "2", "data-kind": "paragraph" }),
		];
		const thread = node({ "data-line": "2" });
		const orphan = node({});
		applyView(page(blocks, [thread, orphan]), "changed");
		// A note whose block is hidden has no text to refer to; one no block claims is its own.
		expect(thread.hidden).toBe(true);
		expect(orphan.hidden).toBe(false);

		applyView(page(blocks, [thread, orphan]), "all");
		expect(thread.hidden).toBe(false);
	});

	// `shown` is the whole document in both, so only the reason can say which nothing was found,
	// and a heading the filter wanted is a reason rather than a match: it stays either way.
	test.each([
		["no mark at all", {}, "nothing"],
		["only a heading marked", { "data-changed": "1" }, "headings"],
	] as const)("a filter that matches no prose keeps the document whole: %s", (_case, mark, reason) => {
		const blocks = [
			node({ "data-line": "0", "data-kind": "heading", ...mark }),
			node({ "data-line": "1", "data-kind": "paragraph" }),
		];
		const counts = applyView(page(blocks), "changed");
		expect(blocks.map((entry) => entry.hidden)).toEqual([false, false]);
		expect(counts).toEqual({ shown: 2, hidden: 0, empty: reason });
	});
});

describe("review draft guard", () => {
	/** The fields a comment is written in: the composer under a block, and a card's editor. */
	const DRAFT_FIELDS = ".bf-composer textarea, .bf-comment textarea";
	const planWith = (value: string) => {
		const area = {
			value,
			focused: 0,
			focus() {
				this.focused += 1;
			},
		};
		// Answers only the selector the source asks for; a field it did not look for is a null plan.
		const planEl = {
			querySelector: (selector: string) => (selector === DRAFT_FIELDS ? area : null),
		};
		return { area, planEl: planEl as unknown as Parameters<typeof draftTextarea>[0] };
	};

	test("carries the source, safe to splice into the client bundle", () => {
		for (const fn of [draftTextarea, guardDraft]) {
			expect(WEB_DRAFT_JS.split(String(fn)).length, String(fn).slice(0, 40)).toBe(2);
		}
	});

	test("a field with only whitespace is not a draft", () => {
		expect(draftTextarea(planWith("  \n\t ").planEl)).toBeNull();
		expect(draftTextarea(planWith("half a thought").planEl)?.value).toBe("half a thought");
		expect(draftTextarea(planWith("x").planEl)?.value).toBe("x");
		expect(draftTextarea(null)).toBeNull();
		expect(draftTextarea({ querySelector: () => null } as unknown as Parameters<typeof draftTextarea>[0])).toBeNull();
	});

	test("the way out is refused, named, and the cursor is put where the text is", () => {
		const { area, planEl } = planWith("half a thought");
		const painted: Array<{ text: string; kind: string | undefined }> = [];
		const guard = (value: string) =>
			guardDraft(planEl, {} as Parameters<typeof guardDraft>[1], value, (_node, text, kind) => {
				painted.push({ text, kind });
			});
		expect(guard("Add or discard the comment you are writing.")).toBe(true);
		expect(painted).toEqual([{ text: "Add or discard the comment you are writing.", kind: "error" }]);
		expect(area.focused).toBe(1);

		// With nothing half-written, every way out is allowed and nothing is painted.
		painted.length = 0;
		expect(guardDraft(planWith("").planEl, null, "refusal", () => painted.push({ text: "x", kind: undefined }))).toBe(
			false,
		);
		expect(painted).toEqual([]);
	});
});
