/**
 * Capture the docs screenshots (dev tooling).
 *
 * `render <name>` prints one frame as ANSI on any OS and needs no window; naming
 * screens captures only those, and with no argument every frame is captured — the
 * `chrome` hero is one of them. macOS only for a capture, because it drives
 * Terminal.app. The frames are in `screens/`, the capture mechanisms in `capture/`.
 */

import { writeFileSync } from "node:fs";
import { numberArg } from "./cli.ts";
import { sleep } from "./poll.ts";
import { frame, SCREENS } from "./screens/index.ts";
import { captureScreen, createProfile, deleteProfile } from "./capture/terminal.ts";

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args[0] === "render") {
		const width = numberArg(args, "--width") ?? process.stdout.columns ?? 100;
		const rows = numberArg(args, "--rows") ?? process.stdout.rows ?? 30;
		const screen = SCREENS[args[1]];
		if (!screen) {
			console.error(`Unknown screen "${args[1]}". Known: chrome, ${Object.keys(SCREENS).join(", ")}`);
			process.exit(1);
		}
		process.stdout.write(frame(screen, width, rows));
		const readyIndex = args.indexOf("--ready");
		const ready = readyIndex >= 0 ? args[readyIndex + 1] : undefined;
		if (ready) writeFileSync(ready, "");
		if (args.includes("--hold")) {
			// A bare pending promise does not keep the event loop alive, so hold the
			// frame with a long timer until the capture kills the process.
			process.on("SIGTERM", () => process.exit(0));
			process.on("SIGINT", () => process.exit(0));
			await sleep(24 * 60 * 60 * 1000);
		}
		return;
	}
	if (process.platform !== "darwin") {
		console.error("Capture needs macOS (Terminal.app + screencapture). Use `render <name>` to preview.");
		process.exit(1);
	}
	const names = args.length > 0 ? args : Object.keys(SCREENS);
	createProfile();
	try {
		for (const name of names) {
			const screen = SCREENS[name];
			if (!screen) {
				console.error(`Unknown screen "${name}". Known: ${Object.keys(SCREENS).join(", ")}`);
				process.exit(1);
			}
			await captureScreen(name, screen);
		}
	} finally {
		deleteProfile();
	}
}

if (import.meta.main) {
	void main();
}
