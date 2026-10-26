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
 *     [--wait 8000] [--out <dir>] [--dialog card]
 *
 * Output defaults to `assets/screens/board.png` and `assets/screens/team.png`; with
 * `--dialog` it writes the card dialog instead, which is how a state the page hides
 * until a click is reviewed as a picture.
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
export type ShotDialog = "card";

/** CLI options after parsing. */
export interface ShotOptions extends PageShotOptions {
	/** Directory the two PNGs are written to. */
	outDir: string;
	/** Capture the card dialog instead of the two tabs. */
	dialog?: ShotDialog;
}

/** Parse the command line; throws a message the caller prints as usage. */
export function parseArgs(argv: string[]): ShotOptions {
	const parsed = parseShotArgs(argv, {
		out: "assets/screens",
		scale: 1,
		extraFlags: ["--out", "--dialog"],
		maxPositional: 0,
	});
	const dialog = parsed.values["--dialog"];
	if (dialog !== undefined && dialog !== "card") throw new Error("--dialog must be card");
	return {
		outDir: resolve(parsed.values["--out"] ?? parsed.out),
		width: parsed.width,
		scale: parsed.scale,
		theme: parsed.theme,
		waitMs: parsed.waitMs,
		out: parsed.out,
		...(dialog === undefined ? {} : { dialog }),
	};
}

/**
 * The click that opens the card dialog on the fixture board.
 *
 * Card 1 and not the first card drawn: it is the one the fixture gives an owner, a long
 * plan path, and two notes, so the picture shows the record at its fullest instead of
 * the one-line card that happens to sit in the first lane.
 */
const DIALOG_OPEN: Record<ShotDialog, string> = {
	card: "document.querySelector('.board-card[data-card=\"1\"] .board-card__title').click()",
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
		page: async (view) => renderBoardPage({ view }),
		script: BOARD_CLIENT_JS,
		view: fixture.view,
	});
	const shots: Array<{ url: string; name: string; before?: string[] }> =
		options.dialog === undefined
			? [
					{ url: tabUrl(server.url, "board"), name: "board" },
					{ url: tabUrl(server.url, "team"), name: "team" },
				]
			: [
					{
						url: tabUrl(server.url, "board"),
						name: `${options.dialog}-dialog`,
						before: [DIALOG_OPEN[options.dialog]],
					},
				];
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
		"usage: bun run screenshot:board [--out <dir>] [--width 1280] [--scale 1] [--theme light|dark] [--wait 8000] [--dialog card]",
		() => main(),
	);
}
