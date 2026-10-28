/**
 * The reader's place on the page: the outline and the section watcher, block
 * navigation, the view filter, and the draft guard that keeps a half-written
 * comment from being lost.
 */

import { describe, expect, test } from "bun:test";
import { REVIEW_CLIENT_JS } from "./web-client.ts";
import { applyView, blockAtLine, blockElements, moveActive, setActive, WEB_BLOCKS_JS } from "./web-blocks.ts";
import { draftTextarea, guardDraft, WEB_DRAFT_JS } from "./web-draft.ts";
import { observeSections, renderFacts, sectionFor, WEB_OUTLINE_JS } from "./web-outline.ts";

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
		// The bundle is a template literal: a backtick or an interpolation would end it.
		expect(WEB_OUTLINE_JS).not.toContain("`");
		expect(WEB_OUTLINE_JS).not.toContain("${");
		expect(WEB_OUTLINE_JS.split(String(sectionFor)).length).toBe(2);
		expect(REVIEW_CLIENT_JS).toContain("renderOutline(outlineList, outlineEntries())");
	});

	test("watches the blocks and marks the section the reader is in", () => {
		// The watcher is the page's own rule for "which section am I in": the last block
		// that crossed the top margin wins, and a page with no headings needs none.
		const made: Array<{ rootMargin: string; observed: string[] }> = [];
		class FakeObserver {
			readonly rootMargin: string;
			readonly observed: string[] = [];
			disconnected = false;
			constructor(callback: unknown, options: { rootMargin?: string }) {
				this.rootMargin = options.rootMargin ?? "";
				this.callback = callback as (entries: Array<{ isIntersecting: boolean; target: { id: string } }>) => void;
				made.push(this);
			}
			private readonly callback: (entries: Array<{ isIntersecting: boolean; target: { id: string } }>) => void;
			observe(node: { id: string }): void {
				this.observed.push(node.id);
			}
			disconnect(): void {
				this.disconnected = true;
			}
			fire(...ids: string[]): void {
				this.callback(ids.map((id) => ({ isIntersecting: true, target: { id } })));
			}
		}
		const before = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
		(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeObserver;
		try {
			const link = (id: string) => {
				const node = {
					id,
					attributes: new Map<string, string>([["data-id", id]]),
					setAttribute(name: string, value: string) {
						node.attributes.set(name, value);
					},
					getAttribute(name: string) {
						return node.attributes.get(name) ?? null;
					},
					removeAttribute(name: string) {
						node.attributes.delete(name);
					},
				};
				return node;
			};
			const links = [link("s-1"), link("s-8")];
			const headings = [{ id: "s-1" }, { id: "s-8" }];
			const list = { querySelectorAll: () => links } as unknown as Parameters<typeof observeSections>[1];
			const planEl = { querySelectorAll: () => headings } as unknown as Parameters<typeof observeSections>[0];

			const watcher = observeSections(planEl, list, null) as unknown as FakeObserver;
			expect(watcher.observed).toEqual(["s-1", "s-8"]);
			expect(watcher.rootMargin).toBe("-88px 0px -68% 0px");

			watcher.fire("s-8");
			expect(links[1]?.getAttribute("aria-current")).toBe("true");
			expect(links[0]?.getAttribute("aria-current")).toBeNull();
			watcher.fire("s-1");
			expect(links[0]?.getAttribute("aria-current")).toBe("true");
			// One section at a time: the previous marker is cleared, not left behind.
			expect(links[1]?.getAttribute("aria-current")).toBeNull();

			const replacement = observeSections(planEl, list, watcher) as unknown as FakeObserver;
			expect(watcher.disconnected).toBe(true);
			expect(replacement.disconnected).toBe(false);

			// No headings, or no list, is no watcher: the page has nothing to follow.
			expect(
				observeSections({ querySelectorAll: () => [] } as unknown as Parameters<typeof observeSections>[0], list, null),
			).toBeNull();
			expect(observeSections(planEl, null, null)).toBeNull();
		} finally {
			(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = before;
		}
	});

	test("paints the facts, and counts each comment under the heading above it", () => {
		// The counters are renderOutline's own output, so the section a comment lands in is
		// the same rule the list was built with; a comment anchored above the first heading
		// is in no section and must not be counted into one.
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
		const made: Array<{ tag: string; className: string }> = [];
		const build = (tag: string, className?: string) => {
			const node = {
				tag,
				className: className ?? "",
				textContent: null as string | null,
				hidden: false,
				href: "",
				title: "",
				id: "",
				children: [] as unknown[],
				setAttribute() {},
				appendChild(child: unknown) {
					node.children.push(child);
				},
				replaceChildren() {
					node.children = [];
				},
			};
			made.push({ tag, className: node.className });
			return node;
		};
		const runtime = new Function("el", `${WEB_OUTLINE_JS}\nreturn { renderOutline: renderOutline };`)(build) as {
			renderOutline: typeof import("./web-outline.ts").renderOutline;
		};
		const list = build("ul", "review-nav") as unknown as Parameters<typeof runtime.renderOutline>[0];
		const counters = runtime.renderOutline(list, entries);
		expect(Object.keys(counters)).toEqual(["1", "8", "20"]);
		expect(made.filter((item) => item.tag === "li").map((item) => item.className)).toEqual(["lvl-1", "lvl-2", "lvl-1"]);
		expect(counters[8]?.hidden).toBe(true);
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
		expect(WEB_BLOCKS_JS).not.toContain("`");
		expect(WEB_BLOCKS_JS).not.toContain("${");
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

	test("a filter that matches nothing but headings keeps the document whole", () => {
		const blocks = [
			node({ "data-line": "0", "data-kind": "heading" }),
			node({ "data-line": "1", "data-kind": "paragraph" }),
		];
		// No block carries a change mark, so the Changed view has nothing to show.
		const counts = applyView(page(blocks), "changed");
		expect(blocks.map((entry) => entry.hidden)).toEqual([false, false]);
		expect(counts).toEqual({ shown: 2, hidden: 0 });
	});
});

describe("review draft guard", () => {
	const planWith = (value: string) => {
		const area = {
			value,
			focused: 0,
			focus() {
				this.focused += 1;
			},
		};
		const planEl = {
			querySelector: (selector: string) => (selector === ".bf-composer" ? { querySelector: () => area } : null),
		};
		return { area, planEl: planEl as unknown as Parameters<typeof draftTextarea>[0] };
	};

	test("carries the source, safe to splice into the client bundle", () => {
		expect(WEB_DRAFT_JS).not.toContain("`");
		expect(WEB_DRAFT_JS).not.toContain("${");
		for (const fn of [draftTextarea, guardDraft]) {
			expect(WEB_DRAFT_JS.split(String(fn)).length, String(fn).slice(0, 40)).toBe(2);
		}
	});

	test("a composer with only whitespace is not a draft", () => {
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
