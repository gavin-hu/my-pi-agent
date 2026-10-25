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
 *     [--wait 8000] [--out <dir>]
 *
 * Output defaults to `assets/screens/board.png` and `assets/screens/team.png`.
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

/** CLI options after parsing. */
export interface ShotOptions extends PageShotOptions {
	/** Directory the two PNGs are written to. */
	outDir: string;
}

/** Parse the command line; throws a message the caller prints as usage. */
export function parseArgs(argv: string[]): ShotOptions {
	const parsed = parseShotArgs(argv, { out: "assets/screens", scale: 1, extraFlags: ["--out"], maxPositional: 0 });
	return {
		outDir: resolve(parsed.values["--out"] ?? parsed.out),
		width: parsed.width,
		scale: parsed.scale,
		theme: parsed.theme,
		waitMs: parsed.waitMs,
		out: parsed.out,
	};
}

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
		// A capture never writes; the page's write route is exercised by its suite.
		write: async () => ({ ok: false, status: 422, error: "The capture does not write." }),
	});
	try {
		for (const view of ["board", "team"] as const) {
			const out = resolve(options.outDir, `${view}.png`);
			mkdirSync(dirname(out), { recursive: true });
			await capturePage({
				url: tabUrl(server.url, view),
				out,
				width: options.width,
				scale: options.scale,
				theme: options.theme,
				waitMs: options.waitMs,
				ready: READY,
			});
			console.log(`${view}: ${out}`);
		}
	} finally {
		await server.close();
		rmSync(fixture.directory, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	runCli(
		"usage: bun run screenshot:board [--out <dir>] [--width 1280] [--scale 1] [--theme light|dark] [--wait 8000]",
		() => main(),
	);
}
