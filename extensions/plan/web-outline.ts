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

/** The pieces of a DOM node the outline touches. */
export interface OutlineNode {
	className: string;
	textContent: string | null;
	hidden: boolean;
	href: string;
	title: string;
	id: string;
	setAttribute(name: string, value: string): void;
	getAttribute(name: string): string | null;
	removeAttribute(name: string): void;
	appendChild(child: OutlineNode): void;
	replaceChildren(): void;
	querySelectorAll(selector: string): ArrayLike<OutlineNode>;
}

/** What the browser's `IntersectionObserver` answers for a section watcher. */
export interface SectionWatcher {
	observe(target: OutlineNode): void;
	disconnect(): void;
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

/**
 * Watch the blocks and mark the section the reader is in, replacing any previous watcher.
 *
 * The observer is returned rather than stored, so the client owns the one handle it has to
 * disconnect and this function owns the rule: the last block still in the document the
 * observer was built over wins, and a page with no headings needs no watcher at all.
 */
export function observeSections(
	planEl: OutlineNode | null,
	list: OutlineNode | null,
	previous: SectionWatcher | null,
): SectionWatcher | null {
	if (previous) previous.disconnect();
	if (!planEl || !list) return null;
	const Observer = (
		globalThis as unknown as {
			IntersectionObserver?: new (
				callback: (entries: ArrayLike<{ isIntersecting: boolean; target: { id: string } }>) => void,
				options: Record<string, unknown>,
			) => SectionWatcher;
		}
	).IntersectionObserver;
	if (!Observer) return null;
	const links: Record<string, OutlineNode> = {};
	const anchors = list.querySelectorAll("a");
	for (let i = 0; i < anchors.length; i++) {
		const link = anchors[i];
		if (link) links[link.getAttribute("data-id") ?? ""] = link;
	}
	const headings = planEl.querySelectorAll(".bf-block[id]");
	if (headings.length === 0) return null;
	const watcher = new Observer(
		(entries) => {
			for (let i = 0; i < entries.length; i++) {
				const entry = entries[i];
				if (!entry || !entry.isIntersecting) continue;
				const all = list.querySelectorAll("a");
				for (let j = 0; j < all.length; j++) all[j]?.removeAttribute("aria-current");
				const link = links[entry.target.id];
				if (link) link.setAttribute("aria-current", "true");
			}
		},
		{ rootMargin: "-88px 0px -68% 0px", threshold: 0 },
	);
	for (let i = 0; i < headings.length; i++) {
		const heading = headings[i];
		if (heading) watcher.observe(heading);
	}
	return watcher;
}

/** The section list, its one rule, and the watcher that marks where the reader is. */
export const WEB_OUTLINE_JS = [sectionFor, renderOutline, observeSections].map(String).join("\n\n");
