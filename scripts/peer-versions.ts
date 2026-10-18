/**
 * Names the Pi versions a run was tested against.
 *
 * The package keeps `@earendil-works/pi-*` and `typebox` as peer dependencies
 * with a `"*"` range, because the Pi host supplies them; that leaves "works with
 * Pi" as a claim that needs a record. The `compat` CI job installs the newest
 * published peers and calls this script, so the run names what it proved and the
 * job summary carries the same list.
 *
 * The peer list is read from `package.json`, so adding a peer adds a row without
 * editing this file. A missing package is an error, not a blank line: a
 * half-installed tree must not look like a tested one.
 *
 * Usage: `bun run compat:versions`
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** One installed peer. */
export interface PeerVersion {
	name: string;
	version: string;
}

const root = join(import.meta.dir, "..");

/** Every declared peer, with the version installed for it under `root`. */
export function peerVersions(dir: string): PeerVersion[] {
	const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
		peerDependencies?: Record<string, string>;
	};
	const names = Object.keys(manifest.peerDependencies ?? {}).sort();
	return names.map((name) => {
		const path = join(dir, "node_modules", name, "package.json");
		if (!existsSync(path)) {
			throw new Error(`${name} is not installed (${path}); run bun install first.`);
		}
		const installed = JSON.parse(readFileSync(path, "utf-8")) as { version?: unknown };
		if (typeof installed.version !== "string") throw new Error(`${name} declares no version in ${path}.`);
		return { name, version: installed.version };
	});
}

/** One aligned `name  version` line per peer, for a terminal or a log. */
export function formatVersions(versions: readonly PeerVersion[]): string[] {
	const width = Math.max(...versions.map((entry) => entry.name.length));
	return versions.map((entry) => `${entry.name.padEnd(width)}  ${entry.version}`);
}

/** The same list as a markdown table, for `$GITHUB_STEP_SUMMARY`. */
export function formatSummary(versions: readonly PeerVersion[]): string {
	const rows = versions.map((entry) => `| \`${entry.name}\` | ${entry.version} |`);
	return ["### Tested Pi peers", "", "| Package | Version |", "|---|---|", ...rows, ""].join("\n");
}

if (import.meta.main) {
	let versions: PeerVersion[];
	try {
		versions = peerVersions(root);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
	process.stdout.write(`${formatVersions(versions).join("\n")}\n`);
	const summary = process.env.GITHUB_STEP_SUMMARY;
	if (summary) appendFileSync(summary, formatSummary(versions));
}
