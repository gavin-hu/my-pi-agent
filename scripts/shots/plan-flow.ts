/**
 * Capture the plan-flow cards with headless Chrome (dev tooling).
 *
 * The pages under `assets/cards/` are posters, not app surfaces: a fixed 1200×675
 * box, no server, no script, and no webfont, so they open from `file://` and
 * post to X as a pair. This finds the Chrome the machine already has
 * (`PI_CHROME` first, then the usual bundles) and writes the PNG a card is
 * posted as — 2× by default, so the text stays crisp where X scales it.
 *
 *   bun run screenshot:plan-flow             # every card
 *   bun run screenshot:plan-flow graphic     # one card
 *   bun run screenshot:plan-flow flow -o /tmp/flow.png --scale 3
 *
 * A card that outgrows its own 1200×675 box fails the run with the measured
 * size instead of being captured clipped, because the image is the whole page.
 */

import { fileURLToPath } from "node:url";
import { captureFullPage, readyWhen } from "../capture/chrome.ts";
import { parseShotArgs, runCli } from "../cli.ts";

/** The box every card declares in `plan-flow.css`; the image is exactly this. */
const CARD_WIDTH = 1200;
const CARD_HEIGHT = 675;

/** One card: the page to open and the PNG it is published as. */
interface Card {
	/** File name under `assets/cards/`. */
	page: string;
	/** Default output file name under `assets/cards/`. */
	png: string;
}

/** The cards, keyed by the name the command line takes. */
const CARDS: Record<string, Card> = {
	flow: { page: "plan-flow.html", png: "plan-flow.png" },
	graphic: { page: "plan-flow-graphic.html", png: "plan-flow-graphic.png" },
};

/** `assets/cards/`, anchored to this script so a capture does not depend on the cwd. */
const ASSETS = new URL("../../assets/cards/", import.meta.url);

/** The options after parsing; the card names are already validated. */
export interface ShotOptions {
	/** Cards to capture, in the order given, or both. */
	cards: string[];
	/** One output path for one card, or an empty string for the defaults. */
	out: string;
	/** Device pixel ratio. */
	scale: number;
	/** How long to wait for the page to settle, in milliseconds. */
	waitMs: number;
}

/** Parse the command line; throws a message the caller prints as usage. */
export function parseArgs(argv: string[]): ShotOptions {
	const parsed = parseShotArgs(argv, { out: "", scale: 2, maxPositional: 1 });
	if (argv.includes("--width")) throw new Error("--width is fixed: a card is a 1200×675 box");
	const cards = parsed.positional.length > 0 ? parsed.positional : Object.keys(CARDS);
	for (const name of cards) {
		if (!(name in CARDS)) throw new Error(`unknown card "${name}"; expected ${Object.keys(CARDS).join(" or ")}`);
	}
	if (cards.length > 1 && parsed.out) throw new Error("-o names one file; capture one card at a time");
	return { cards, out: parsed.out, scale: parsed.scale, waitMs: parsed.waitMs };
}

/** Resolves once the stylesheet is applied and the card is in the document. */
function readyExpression(waitMs: number): string {
	return readyWhen('document.fonts.status === "complete" && !!document.querySelector(".card")', waitMs);
}

/**
 * Fails the capture when the card's content outgrows it. The card clips, so a
 * child's box is the only honest measurement: the document has no scroll extent
 * to compare, and the rendered PNG would otherwise look complete while its last
 * line was cut.
 */
const FITS_CARD = `(function () {
	var card = document.querySelector(".card");
	if (!card) throw new Error("the card is missing");
	var box = card.getBoundingClientRect();
	var widest = 0;
	var lowest = 0;
	var nodes = card.querySelectorAll("*");
	for (var index = 0; index < nodes.length; index++) {
		var rect = nodes[index].getBoundingClientRect();
		widest = Math.max(widest, rect.right - box.left);
		lowest = Math.max(lowest, rect.bottom - box.top);
	}
	if (widest > ${CARD_WIDTH} + 0.5 || lowest > ${CARD_HEIGHT} + 0.5) {
		throw new Error("the card overflows: content reaches " + Math.round(widest) + "×" +
			Math.round(lowest) + " in a ${CARD_WIDTH}×${CARD_HEIGHT} box");
	}
	return Math.round(widest) + "×" + Math.round(lowest);
})()`;

/** Capture one card and print the path written. */
async function capture(name: string, options: ShotOptions): Promise<void> {
	const card = CARDS[name];
	const page = fileURLToPath(new URL(card.page, ASSETS));
	const out = options.out || fileURLToPath(new URL(card.png, ASSETS));
	await captureFullPage({
		url: `file://${page}`,
		origin: "file://",
		out,
		width: CARD_WIDTH,
		scale: options.scale,
		before: [{ expression: readyExpression(options.waitMs) }, { expression: FITS_CARD }],
	});
	console.log(out);
}

const USAGE = `usage: bun run screenshot:plan-flow [${Object.keys(CARDS).join("|")}] [-o out.png] [--scale 2] [--wait 8000]`;

if (import.meta.main) {
	runCli(USAGE, async () => {
		const options = parseArgs(process.argv.slice(2));
		for (const name of options.cards) await capture(name, options);
	});
}
