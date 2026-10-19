/**
 * Shared page preparation for the browser screenshots (dev tooling).
 *
 * Both browser surfaces draw the `lib/web` app shell: a viewport-height flex
 * column whose sidebar and document scroll inside it. A full-page capture would
 * therefore show one screenful with the rest clipped, so the shell is
 * un-constrained first and the columns grow to their content instead.
 */

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
