/**
 * The review page's outline: the section list in the sidebar, and the one rule that says
 * which section a source line belongs to.
 *
 * Written as ordinary TypeScript and exported as source — `WEB_OUTLINE_JS` — because the
 * review client is a template literal no compiler sees. The two functions are given what
 * they read rather than closing over the bundle's variables, which is what makes them
 * testable here: `renderOutline` returns the per-line counters it built instead of
 * assigning the client's `outlineItems`, and `sectionFor` takes the outline it searches.
 *
 * `el` is the client runtime's builder, declared here because this source is spliced into
 * the same bundle it lives in: the declaration emits nothing, so the body calls the one
 * builder. The nodes are reached through a structural type because this project compiles
 * without a DOM lib; the annotations are erased before the source is spliced.
 */

/** One entry of the page's `outline` island: a heading, its line, and whether it moved. */
export interface OutlineEntry {
	id: string;
	level: number;
	line: number;
	text: string;
	changed?: boolean;
}

/** The pieces of a DOM node these two functions touch. */
export interface OutlineNode {
	className: string;
	textContent: string | null;
	hidden: boolean;
	href: string;
	title: string;
	id: string;
	setAttribute(name: string, value: string): void;
	appendChild(child: OutlineNode): void;
	replaceChildren(): void;
}

/** What `el` has to answer for an outline. Spliced beside it; declared for the checker. */
type Build = (tag: string, className?: string, text?: string | null) => OutlineNode;
declare const el: Build;

/**
 * The section a source line belongs to: the last heading at or before it.
 *
 * `null` when the line sits above the first heading, which is how a preamble renders
 * without a section of its own.
 */
export function sectionFor(entries: readonly OutlineEntry[], line: number): OutlineEntry | null {
	let found: OutlineEntry | null = null;
	for (const item of entries) if (item.line <= line) found = item;
	return found;
}

/**
 * Draw the section list and return the counter each line owns.
 *
 * The caller keeps the returned map because the counters are updated later, when the
 * comments are counted per section; returning it is what lets this function be a pure
 * build with no handle on the client's state.
 */
export function renderOutline(list: OutlineNode | null, entries: readonly OutlineEntry[]): Record<number, OutlineNode> {
	const counters: Record<number, OutlineNode> = {};
	if (!list) return counters;
	list.replaceChildren();
	for (const item of entries) {
		const li = el("li", "lvl-" + item.level);
		const link = el("a");
		link.href = "#" + item.id;
		link.setAttribute("data-id", item.id);
		const label = el("span", "review-nav__link");
		label.textContent = item.text;
		link.appendChild(label);
		if (item.changed) {
			const dot = el("span", "review-changed");
			dot.setAttribute("role", "img");
			dot.setAttribute("aria-label", "Changed since your last review");
			dot.title = "Changed since your last review";
			link.appendChild(dot);
		}
		const count = el("span", "review-nav__count");
		count.hidden = true;
		link.appendChild(count);
		li.appendChild(link);
		list.appendChild(li);
		counters[item.line] = count;
	}
	return counters;
}

/** Both functions as source, for the client bundle. */
export const WEB_OUTLINE_JS = [sectionFor, renderOutline].map(String).join("\n\n");
