/**
 * What the review's view switch writes: which segment is pressed, which is off, and the line under
 * it.
 *
 * Written as ordinary TypeScript and exported as source — `WEB_VIEWS_JS` — because the review
 * client is a template literal no compiler sees. It is a rule rather than the composition root's
 * work: "this view is off, and here is why" is the same question on every page, and the shape of
 * the answer is not the client's to decide.
 *
 * The reason lives in the note line and the switch's group describes itself with it, added with
 * the sentence and taken away with it. A `title` on the disabled segment is what this replaces: a
 * disabled control leaves the tab order, so a keyboard reader never reaches it and a touch reader
 * never hovers it.
 */

import { pageSource } from "../../lib/format.ts";

/** What a segment answers: the attributes the switch writes, and whether it can be pressed. */
interface Segment {
	getAttribute(name: string): string | null;
	setAttribute(name: string, value: string): void;
	disabled: boolean;
}

/** The nodes the switch writes: its segments, the note line, and the group it describes itself with. */
export interface ViewSwitch {
	segments: ArrayLike<Segment>;
	/** The note line, which hides itself when neither part has anything to say. */
	line: { hidden: boolean } | null;
	/** The view's own sentence, inside the line's live region. */
	sentence: { textContent: string | null } | null;
	/** The reason a view is off, inside the same line, and the element the group describes itself with. */
	reason: { textContent: string | null; hidden: boolean } | null;
	group: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void } | null;
}

/**
 * Apply one view to the switch.
 *
 * A view the page cannot offer is off: nothing to compare against is not an empty view. The
 * description arrives with the reason and goes with it, so a page that offers every view
 * describes itself with nothing rather than pointing at a hidden span.
 */
export function syncSwitch(
	nodes: ViewSwitch,
	view: string,
	offered: readonly string[],
	sentence: string,
	reason: string,
): void {
	for (let i = 0; i < nodes.segments.length; i++) {
		const segment = nodes.segments[i];
		if (!segment) continue;
		const name = segment.getAttribute("data-view");
		segment.setAttribute("aria-pressed", name === view ? "true" : "false");
		segment.disabled = offered.indexOf(name ?? "") < 0;
	}
	if (nodes.reason) {
		nodes.reason.textContent = reason;
		nodes.reason.hidden = reason === "";
	}
	if (nodes.group) {
		if (reason === "") nodes.group.removeAttribute("aria-describedby");
		else nodes.group.setAttribute("aria-describedby", "review-view-why");
	}
	if (nodes.sentence) nodes.sentence.textContent = sentence;
	if (nodes.line) nodes.line.hidden = sentence === "" && reason === "";
}

/** The rule and nothing else, for the client bundle. */
export const WEB_VIEWS_JS = pageSource(syncSwitch);
