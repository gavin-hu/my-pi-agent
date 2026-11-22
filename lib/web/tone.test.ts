/**
 * A tone's paint: a `bf-tone--*` modifier beats the default colour of the element that wears it.
 *
 * The kit's base rules — `.bf-tag`, `.bf-live`, `.bf-reload` — each set a default colour at
 * single-class specificity, and a tone sets one the same way. Equal specificity means the later
 * rule wins, so the tone set has to sit below them: while it sat above, `bf-tone--warn` and
 * `bf-tone--dim` both painted `--muted`, and no page could show a warn tag. A stylesheet string
 * cannot prove a cascade, so this boots the browser and reads the result — each element's
 * computed colour against a probe painted `var(--token)`, in both appearances, with no hex
 * written here.
 *
 * It needs a browser. Where the machine has none the suite skips, naming `PI_CHROME`, so
 * `bun run check` stays green on a runner without Chrome and still says why nothing ran.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { findChrome } from "../../scripts/capture/chrome.ts";
import { type TestBrowser, launchBrowser } from "../../test/helpers/browser.ts";
import { WEB_COMPONENTS_CSS } from "./components.ts";
import { WEB_THEME_CSS } from "./tokens.ts";

/** The browser this machine has, or nothing: the suite skips on a runner without one. */
const CHROME = findChrome();

/** One boot and one teardown: the page is small, and both appearances read the same one. */
const HOOK_MS = 30_000;

/** What each painted element's colour and the probe of its token read back as, per element. */
interface Painted {
	plain: [string, string];
	warn: [string, string];
	dim: [string, string];
	success: [string, string];
}

/**
 * The four elements the case paints.
 *
 * A plain tag and a toned one share `.bf-tag`, so the pair says the default survived and the
 * modifier won; the dim tag names the one tone whose colour is quieter than the default; and the
 * live chip is the second element family the same collision killed.
 */
const PAINTS = [
	{ id: "plain", token: "muted", classes: "bf-tag" },
	{ id: "warn", token: "warn", classes: "bf-tag bf-tone--warn" },
	{ id: "dim", token: "dim", classes: "bf-tag bf-tone--dim" },
	{ id: "success", token: "success", classes: "bf-live bf-tone--success" },
] as const satisfies readonly { id: keyof Painted; token: string; classes: string }[];

/** The page: the sheet a served page carries, one element per rule, and one probe per token. */
const PAGE = `<!doctype html><html><head><style>${WEB_THEME_CSS}\n${WEB_COMPONENTS_CSS}</style></head><body>${PAINTS.map(
	(paint) =>
		`<span id="${paint.id}" class="${paint.classes}">${paint.id}</span>` +
		`<span id="probe-${paint.id}" style="color:var(--${paint.token})">${paint.id}</span>`,
).join("")}</body></html>`;

/**
 * What the page painted, in one appearance.
 *
 * The theme is set through its own attribute — `:root` carries dark, `:root[data-theme=light]`
 * the other — so one page answers both cases without a second navigation.
 */
async function painted(page: Page, appearance: "dark" | "light"): Promise<Painted> {
	return page.evaluate((theme: "dark" | "light") => {
		const dom = globalThis as unknown as {
			document: {
				documentElement: { setAttribute(name: string, value: string): void };
				querySelector(selector: string): unknown;
			};
			getComputedStyle(node: unknown): { color: string };
		};
		dom.document.documentElement.setAttribute("data-theme", theme);
		const colour = (id: string): string => {
			const node = dom.document.querySelector(`#${id}`);
			if (node === null) throw new Error(`#${id} is not on the page`);
			return dom.getComputedStyle(node).color;
		};
		return {
			plain: [colour("plain"), colour("probe-plain")],
			warn: [colour("warn"), colour("probe-warn")],
			dim: [colour("dim"), colour("probe-dim")],
			success: [colour("success"), colour("probe-success")],
		};
	}, appearance);
}

let browser: TestBrowser | undefined;
let page: Page | undefined;

describe.skipIf(CHROME === undefined)("a tone's paint (needs PI_CHROME)", () => {
	beforeAll(async () => {
		browser = await launchBrowser(CHROME);
		page = await browser.newPage({ viewport: { width: 640, height: 200 } });
		await page.setContent(PAGE, { waitUntil: "load" });
	}, HOOK_MS);

	afterAll(async () => {
		await page?.close();
		await browser?.close();
	});

	for (const appearance of ["dark", "light"] as const) {
		test(`each tone paints its token, ${appearance}`, async () => {
			if (page === undefined) throw new Error("the page was not opened");
			const read = await painted(page, appearance);
			for (const paint of PAINTS) {
				expect(read[paint.id][0], `${paint.classes} in ${appearance}`).toBe(read[paint.id][1]);
			}
			// The defect this suite was written for: the toned pair collapsing onto the default.
			expect(read.warn[0], `warn and dim are one colour in ${appearance}`).not.toBe(read.dim[0]);
			// The intended shift: a dim tone is quieter than the tag's own default.
			expect(read.dim[0], `dim is the default in ${appearance}`).not.toBe(read.plain[0]);
		});
	}
});
