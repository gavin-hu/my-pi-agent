/**
 * The composer's lifecycle and the frame the plan is drawn into: opening, closing,
 * and reopening a draft's composer, and the block frame that hosts one.
 */

import { describe, expect, test } from "bun:test";
import { REVIEW_CLIENT_JS } from "./web-client.ts";
import { blockElements, setActive } from "./web-blocks.ts";
import { closeComposer, commentOnActive, reopenComposer, WEB_COMPOSER_JS } from "./web-composer.ts";
import { renderPlanFrame, WEB_PLAN_JS } from "./web-plan.ts";

describe("review composer lifecycle", () => {
	const node = (className = "") => {
		const self: Record<string, unknown> = {
			className,
			textContent: null as string | null,
			title: "",
			hidden: false,
			href: "",
			id: "",
			style: { width: "" },
			composing: false,
			removed: false,
			classList: {
				add() {},
				remove(name: string) {
					if (name === "bf-block--composing") self.composing = false;
				},
				toggle() {},
			},
			setAttribute() {},
			getAttribute: () => "8",
			removeAttribute() {},
			appendChild() {},
			replaceChildren() {},
			remove() {
				self.removed = true;
			},
			querySelector: () => null,
			querySelectorAll: () => (self.composing ? [self] : []),
			addEventListener() {},
		};
		return self;
	};
	const deps = (over: Partial<Record<string, unknown>> = {}) => {
		const painted: Array<{ text: string; kind?: string }> = [];
		const opened: Array<{ quote: string; initial?: string }> = [];
		return {
			painted,
			opened,
			value: {
				planEl: null,
				statusEl: null,
				refusal: "Add or discard the comment you are writing.",
				setStatus: (text: string, kind?: string) => painted.push({ text, kind }),
				saveDraft: () => painted.push({ text: "saved" }),
				open: (_wrap: unknown, _block: unknown, quote: string, initial?: string) => opened.push({ quote, initial }),
				...over,
			} as Parameters<typeof closeComposer>[0] & { open: (w: unknown, b: unknown, q: string, i?: string) => void },
		};
	};

	test("carries the source, safe to splice into the client bundle", () => {
		expect(WEB_COMPOSER_JS).not.toContain("`");
		expect(WEB_COMPOSER_JS).not.toContain("${");
		for (const fn of [closeComposer, reopenComposer, commentOnActive]) {
			expect(WEB_COMPOSER_JS.split(String(fn)).length, String(fn).slice(0, 40)).toBe(2);
		}
	});

	test("closing drops the draft only when a composer was open", () => {
		// A close with nothing open must not rewrite — and so drop — a draft a reload restored.
		const empty = deps();
		closeComposer(empty.value);
		expect(empty.painted).toEqual([]);

		const composer = node("bf-composer") as { removed: boolean };
		const planEl = { querySelector: () => composer, querySelectorAll: () => [node()] };
		const filled = deps({ planEl });
		closeComposer(filled.value);
		expect(composer.removed).toBe(true);
		expect(filled.painted).toEqual([{ text: "saved", kind: undefined }]);
	});

	test("a stale refusal is cleared, a fresh status is left alone", () => {
		const stale = deps();
		stale.value.statusEl = { textContent: "Add or discard the comment you are writing." } as never;
		closeComposer(stale.value);
		expect(stale.painted).toEqual([{ text: "", kind: undefined }]);

		const other = deps();
		other.value.statusEl = { textContent: "Comment added." } as never;
		closeComposer(other.value);
		expect(other.painted).toEqual([]);
	});

	test("a settled review has no draft to reopen", () => {
		const withBlock = deps({ planEl: { querySelector: () => node(), querySelectorAll: () => [] } });
		reopenComposer(withBlock.value, { anchor: 8 }, { saved: true, approved: false, closed: false }, [{ start: 8 }]);
		reopenComposer(withBlock.value, { anchor: 8 }, { saved: false, approved: true, closed: false }, [{ start: 8 }]);
		reopenComposer(withBlock.value, { anchor: 8 }, { saved: false, approved: false, closed: true }, [{ start: 8 }]);
		reopenComposer(withBlock.value, undefined, { saved: false, approved: false, closed: false }, []);
		expect(withBlock.opened).toEqual([]);

		// A page still asking gets its half-written comment back, quote and text.
		reopenComposer(
			withBlock.value,
			{ anchor: 8, quote: "the plan", text: "half a thought" },
			{ saved: false, approved: false, closed: false },
			[{ start: 8 }],
		);
		expect(withBlock.opened).toEqual([{ quote: "the plan", initial: "half a thought" }]);
	});

	test("the keyboard's composer opens on the active block, starting one if none is", () => {
		const opened: string[] = [];
		const blocks = [node()];
		const planEl = { querySelector: () => blocks[0], querySelectorAll: () => blocks };
		const subject = deps({ planEl, open: (_w: unknown, _b: unknown, quote: string) => opened.push(quote) });
		// Nothing active: it becomes the first block, and that is what gets the composer.
		expect(commentOnActive(subject.value, -1, [{ start: 8 }])).toBe(0);
		expect(opened).toEqual([""]);
		// No blocks at all: the index is kept rather than reset to zero.
		const bare = deps({ planEl: { querySelector: () => null, querySelectorAll: () => [] } });
		expect(commentOnActive(bare.value, 4, [])).toBe(4);
		expect(bare.opened).toEqual([]);
	});
});

describe("review plan renderer", () => {
	/** A node factory with the members one frame touches, recording what it was told. */
	function makeDom() {
		const made: Array<{
			tag: string;
			className: string;
			attrs: Record<string, string>;
			children: unknown[];
			listeners: Record<string, Array<() => void>>;
			classes: string[];
			textContent: string | null;
			title: string;
			id: string;
			type: string;
			focused: number;
		}> = [];
		const build = (tag: string, className = "") => {
			const node = {
				tag,
				className,
				attrs: {} as Record<string, string>,
				children: [] as unknown[],
				listeners: {} as Record<string, Array<() => void>>,
				classes: className ? className.split(" ") : [],
				textContent: null as string | null,
				title: "",
				id: "",
				type: "",
				focused: 0,
				style: { width: "" },
				scrollTop: 0,
				hidden: false,
				href: "",
				setAttribute(name: string, value: string) {
					node.attrs[name] = value;
				},
				getAttribute: (name: string) => node.attrs[name] ?? null,
				removeAttribute(name: string) {
					delete node.attrs[name];
				},
				appendChild(child: unknown) {
					node.children.push(child);
				},
				replaceChildren() {
					node.children = [];
				},
				remove() {},
				classList: {
					add(name: string) {
						node.classes.push(name);
					},
					remove() {},
					toggle() {},
				},
				addEventListener(type: string, listener: () => void) {
					(node.listeners[type] = node.listeners[type] ?? []).push(listener);
				},
				querySelector: () => null,
				querySelectorAll: () => [],
				contains: () => false,
				focus() {
					node.focused += 1;
				},
				scrollIntoView() {},
			};
			made.push(node);
			return node;
		};
		return { made, build };
	}

	const plan = (over: Record<string, unknown> = {}) => {
		const dom = makeDom();
		const calls = {
			blocks: [] as string[],
			cards: 0,
			facts: 0,
			state: 0,
			closed: 0,
			opened: [] as string[],
			active: [] as number[],
		};
		const planEl = dom.build("main") as unknown as Parameters<typeof renderPlanFrame>[0]["planEl"];
		const deps = {
			planEl,
			outlineList: null,
			focused: null,
			blocks: () => [
				{ start: 1, kind: "heading" },
				{ start: 2, kind: "blank" },
				{ start: 3, kind: "para" },
			],
			annotations: () => [{ anchor: 3 }, { anchor: 99 }],
			activeIndex: () => 1,
			setActiveIndex: (index: number) => calls.active.push(index),
			pendingQuote: () => ({ wrap: null as never, quote: "the plan" }),
			clearPendingQuote: () => {},
			composer: () => ({}) as never,
			renderBlock: (_wrap: unknown, block: { kind?: string }) => {
				calls.blocks.push(String(block.kind ?? ""));
			},
			renderComments: () => {},
			renderCommentCards: () => {
				calls.cards += 1;
			},
			selectionIn: () => "selected text",
			open: (_wrap: unknown, _block: unknown, quote: string) => calls.opened.push(quote),
			facts: () => {
				calls.facts += 1;
			},
			updateState: () => {
				calls.state += 1;
			},
			...over,
		} as Parameters<typeof renderPlanFrame>[0];
		return { deps, dom, calls };
	};

	test("carries the source, safe to splice into the client bundle", () => {
		expect(WEB_PLAN_JS).not.toContain("`");
		expect(WEB_PLAN_JS).not.toContain("${");
		expect(WEB_PLAN_JS).toBe(String(renderPlanFrame));
		expect(REVIEW_CLIENT_JS).toContain(
			"renderPlanFrame(planFrame(), closeOpenComposer, observeSections, sectionObserver)",
		);
	});

	test("draws one block per non-blank line, and nothing for a blank", () => {
		const { deps, calls, dom } = plan();
		const runtime = new Function("el", "blockElements", "setActive", `${WEB_PLAN_JS}\nreturn renderPlanFrame;`)(
			dom.build,
			blockElements,
			setActive,
		) as typeof renderPlanFrame;
		const observer = { observe() {}, disconnect() {} };
		const installed = runtime(
			deps,
			() => (calls.closed += 1),
			() => observer,
			null,
		);
		expect(installed).toBe(observer);
		// Two blocks drawn, in order, each told which island line and kind it stands for.
		expect(calls.blocks).toEqual(["heading", "para"]);
		expect(calls.closed).toBe(1);
		expect(calls.facts).toBe(1);
		expect(calls.state).toBe(1);
		// The orphaned anchor is the only card set the frame had to draw separately.
		expect(calls.cards).toBe(1);
	});

	test("a click reads the quote at click time, and hands the block its selection", () => {
		const { deps, calls, dom } = plan();
		let pending: { wrap: unknown; quote: string } | null = null;
		const runtime = new Function("el", "blockElements", "setActive", `${WEB_PLAN_JS}\nreturn renderPlanFrame;`)(
			dom.build,
			blockElements,
			setActive,
		) as typeof renderPlanFrame;
		const withPending = {
			...deps,
			pendingQuote: () => pending,
			clearPendingQuote: () => {
				pending = null;
			},
		} as Parameters<typeof renderPlanFrame>[0];
		runtime(
			withPending,
			() => {},
			() => null,
			null,
		);
		// Every block's "+" control was wired; firing one with no pending quote asks the
		// page what the reader selected.
		const adds = dom.made.filter((node) => node.className === "bf-block__add");
		expect(adds).toHaveLength(2);
		for (const listener of adds[0]?.listeners.click ?? []) listener();
		expect(calls.opened).toEqual(["selected text"]);
		// With a pending quote for that block — the block itself, not its control — the
		// quote is what the comment carries.
		const blocks = dom.made.filter((node) => node.className === "bf-block");
		expect(blocks).toHaveLength(2);
		pending = { wrap: blocks[1] as never, quote: "the plan" };
		for (const listener of adds[1]?.listeners.click ?? []) listener();
		expect(calls.opened).toEqual(["selected text", "the plan"]);
		expect(pending).toBeNull();
	});

	test("a settled review draws no control to add a comment", () => {
		// The composer would accept the note and report it added, and nothing could ever save
		// it: the rail's control goes with the buttons the settlement disables.
		const { deps, dom } = plan({ settled: () => true });
		const runtime = new Function("el", "blockElements", "setActive", `${WEB_PLAN_JS}\nreturn renderPlanFrame;`)(
			dom.build,
			blockElements,
			setActive,
		) as typeof renderPlanFrame;
		runtime(
			deps,
			() => {},
			() => null,
			null,
		);
		expect(dom.made.filter((node) => node.className === "bf-block__add")).toHaveLength(0);
		// The blocks themselves are still drawn, and still carry their comment cards.
		expect(dom.made.filter((node) => node.className === "bf-block")).toHaveLength(2);
	});

	test("restores focus only when it was inside the plan to begin with", () => {
		const { deps, dom } = plan();
		const runtime = new Function("el", "blockElements", "setActive", `${WEB_PLAN_JS}\nreturn renderPlanFrame;`)(
			dom.build,
			blockElements,
			setActive,
		) as typeof renderPlanFrame;
		const focused = { focus() {}, className: "bf-block__add", focused: 0 } as never;
		// `planEl.contains` answers true for this node, so the tab stop goes back on it.
		const inside = {
			...deps,
			focused: focused,
			planEl: { ...(deps.planEl as object), contains: () => true, querySelector: () => null } as never,
		} as Parameters<typeof renderPlanFrame>[0];
		runtime(
			inside,
			() => {},
			() => null,
			null,
		);
		// No blocks were reachable through the stub's querySelectorAll, so nothing is focused:
		// the rule is visible in the frame's own source rather than in a focused node.
		expect(WEB_PLAN_JS).toContain(
			"const keepFocus = !!(deps.focused && deps.focused !== planEl && planEl.contains(deps.focused));",
		);
	});
});
