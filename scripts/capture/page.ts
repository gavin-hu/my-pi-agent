/**
 * One page capture for the browser screenshots (dev tooling).
 *
 * Both browser surfaces draw the `lib/web` app shell: a viewport-height flex
 * column whose sidebar and document scroll inside it. A full-page capture would
 * therefore show one screenful with the rest clipped, so the shell is
 * un-constrained first and the columns grow to their content instead.
 *
 * The step order — force the theme, wait for the page to draw itself, expand the
 * shell — is the same for both surfaces and is behaviour, so it lives here
 * rather than in each script: a shot supplies its URL and its own readiness
 * condition, and nothing else about how a page is prepared.
 */

import { captureFullPage, readyWhen } from "./chrome.ts";

/** Expression that lets the app shell grow to its content; returns the new height. */
export const EXPAND_SHELL_EXPRESSION = `(function () {
	var style = document.createElement("style");
	style.textContent = ".bf-app{height:auto !important;min-height:0 !important;overflow:visible !important}" +
		".bf-app__body{flex:none !important;height:auto !important}" +
		".bf-app__main{overflow:visible !important;height:auto !important}" +
		".bf-app__sidebar{overflow:visible !important;height:auto !important;max-height:none !important}";
	document.head.appendChild(style);
	return document.documentElement.scrollHeight;
})()`;

/**
 * Expression that sets the page theme through its own toggle: the toggle writes
 * `data-theme`, stores the choice, and repaints its glyph and label, so the
 * header cannot disagree with the page the way a bare attribute assignment
 * leaves it.
 */
export function themeExpression(theme: "light" | "dark"): string {
	return `(function () {
	var want = ${JSON.stringify(theme)};
	var light = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
	var current = document.documentElement.getAttribute("data-theme") || (light ? "light" : "dark");
	if (current !== want) {
		var button = document.getElementById("theme-toggle");
		if (button) button.click();
	}
	return document.documentElement.getAttribute("data-theme") || current;
})()`;
}

/** The options every page capture takes; a script adds only the page it serves. */
export interface PageShotOptions {
	/** Absolute PNG output path. */
	out: string;
	/** CSS viewport width. */
	width: number;
	/** Device pixel ratio for a crisp capture. */
	scale: number;
	/** Optional forced theme; the page follows the system when absent. */
	theme?: "light" | "dark";
	/** How long to wait for the client to render, in milliseconds. */
	waitMs: number;
	/** Expressions run after the theme, readiness, and shell expansion — a shot that opens a dialog. */
	before?: readonly string[];
}

/** One page to capture: where it is, and the readiness only that page knows. */
export interface PageShot extends PageShotOptions {
	/** The URL Chrome opens. */
	url: string;
	/** An expression that is true once the page has drawn itself. */
	ready: string;
	/** Scripts installed before the first navigation, for a page that starts with state. */
	init?: string[];
}

/** Capture one page of a shipped browser surface as a full-page PNG. */
export async function capturePage(shot: PageShot): Promise<void> {
	await captureFullPage({
		url: shot.url,
		origin: new URL(shot.url).origin,
		out: shot.out,
		width: shot.width,
		scale: shot.scale,
		...(shot.init === undefined ? {} : { init: shot.init }),
		before: [
			...(shot.theme ? [{ expression: themeExpression(shot.theme) }] : []),
			{ expression: readyWhen(shot.ready, shot.waitMs) },
			{ expression: EXPAND_SHELL_EXPRESSION },
			...(shot.before ?? []).map((expression) => ({ expression })),
		],
	});
}
