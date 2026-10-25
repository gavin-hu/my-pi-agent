/**
 * Screenshot the board page with headless Chrome (dev tooling).
 *
 * Starts the shipped `createBoardServer` over a fixture board — the same router,
 * snapshot, client bundle, and stylesheet `/board` serves — and writes full-page
 * PNGs of both tabs, so the design can be reviewed as an image instead of a
 * description. Nothing here names a real checkout: the store is a temporary
 * directory and the paths are this repository's own directories.
 *
 *   bun run screenshot:board [--width 1280] [--scale 1] [--theme light|dark]
 *     [--wait 8000] [--out <dir>] [--dialog card|confirm|new]
 *
 * Output defaults to `assets/screens/board.png` and `assets/screens/team.png`; with
 * `--dialog` it writes one modal instead, which is how a state the page hides by
 * default is reviewed as a picture.
 */

import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseShotArgs, runCli } from "../cli.ts";
import { type PageShotOptions, capturePage } from "../capture/page.ts";
import { createBoardServer } from "../../extensions/board/transport/server.ts";
import { BOARD_CLIENT_JS } from "../../extensions/board/view/client.ts";
import { renderBoardPage } from "../../extensions/board/view/page.ts";
import { fixtureBoard } from "../tools/fixtures/board-store.ts";

/** The readiness expression: the lanes are painted before the capture. */
const READY = "!!document.querySelector('.board-card')";

/** The dialog a shot can open before it captures, so a modal is reviewed as a picture. */
export type ShotDialog = "card" | "confirm" | "new" | "edit";

/** CLI options after parsing. */
export interface ShotOptions extends PageShotOptions {
	/** Directory the two PNGs are written to. */
	outDir: string;
	/** Capture one dialog instead of the two tabs. */
	dialog?: ShotDialog;
	/** Capture the page a teammate sees: the same board, with no write affordance. */
	viewer?: boolean;
}

/** Parse the command line; throws a message the caller prints as usage. */
export function parseArgs(argv: string[]): ShotOptions {
	const parsed = parseShotArgs(argv, {
		out: "assets/screens",
		scale: 1,
		extraFlags: ["--out", "--dialog"],
		extraBooleans: ["--viewer"],
		maxPositional: 0,
	});
	const dialog = parsed.values["--dialog"];
	if (dialog !== undefined && dialog !== "card" && dialog !== "confirm" && dialog !== "new" && dialog !== "edit") {
		throw new Error("--dialog must be card, confirm, new, or edit");
	}
	return {
		outDir: resolve(parsed.values["--out"] ?? parsed.out),
		width: parsed.width,
		scale: parsed.scale,
		theme: parsed.theme,
		waitMs: parsed.waitMs,
		out: parsed.out,
		...(dialog === undefined ? {} : { dialog }),
		...(parsed.flags.has("--viewer") ? { viewer: true } : {}),
	};
}

/** The click that opens one dialog on the fixture board. */
const DIALOG_OPEN: Record<ShotDialog, string> = {
	card: "document.querySelector('.board-card__title').click()",
	// The first card in reading order is the fixture's `todo` card, whose first
	// action is Claim — the one action that asks before it writes.
	confirm: "document.querySelector('.board-card__actions .bf-btn').click()",
	// The toolbar's button is the way a lead asks for a card; a keyboard-only path
	// would hide the trigger this shot exists to show.
	new: "document.getElementById('board-new').click()",
	// The composer's second mode: the card dialog's Edit opens the same two fields,
	// prefilled, so the state is only visible after two clicks.
	edit: [
		"document.querySelector('.board-card__title').click()",
		"Array.prototype.find.call(document.querySelectorAll('#card-dialog-actions .bf-btn'), function (b) { return b.textContent === 'Edit'; }).click()",
	].join("; "),
};

/** The URL for one tab: the server's own URL already carries the token. */
function tabUrl(url: string, view: "board" | "team"): string {
	return view === "board" ? url : `${url}&view=team`;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	const options = parseArgs(argv);
	const fixture = await fixtureBoard();
	const server = await createBoardServer({
		ports: [0],
		// A viewer's page is the same document with one attribute saying it may not write.
		page: async (view) => renderBoardPage({ view, writes: options.viewer !== true }),
		script: BOARD_CLIENT_JS,
		view: fixture.view,
		// A capture never writes; the page's write route is exercised by its suite.
		write: async () => ({ ok: false, status: 422, error: "The capture does not write." }),
	});
	const shots: Array<{ url: string; name: string; before?: string[] }> =
		options.dialog === undefined
			? [
					{ url: tabUrl(server.url, "board"), name: `board${options.viewer === true ? "-viewer" : ""}` },
					{ url: tabUrl(server.url, "team"), name: `team${options.viewer === true ? "-viewer" : ""}` },
				]
			: [{ url: tabUrl(server.url, "board"), name: `${options.dialog}-dialog`, before: [DIALOG_OPEN[options.dialog]] }];
	try {
		for (const shot of shots) {
			const out = resolve(options.outDir, `${shot.name}.png`);
			mkdirSync(dirname(out), { recursive: true });
			await capturePage({
				url: shot.url,
				out,
				width: options.width,
				scale: options.scale,
				theme: options.theme,
				waitMs: options.waitMs,
				ready: READY,
				...(shot.before === undefined ? {} : { before: shot.before }),
			});
			console.log(`${shot.name}: ${out}`);
		}
	} finally {
		await server.close();
		rmSync(fixture.directory, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	runCli(
		"usage: bun run screenshot:board [--out <dir>] [--width 1280] [--scale 1] [--theme light|dark] [--wait 8000] [--dialog card|confirm|new|edit] [--viewer]",
		() => main(),
	);
}
