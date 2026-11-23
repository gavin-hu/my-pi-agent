/**
 * The dependency layers: what each extension may reach, and which side answers a request.
 *
 * The workflow domain belongs to neither door. Its directory was renamed out of the board
 * extension's name for exactly this reason: `team` imports the domain, and while the directory
 * was named after the board that read looked like a client reaching into another extension's
 * library. Three rules follow, and this suite is the gate on them:
 *
 * - the bus is the floor: it imports no workflow rule and no extension;
 * - team sits above the domain and below board: it may use the domain, never board;
 * - board may use both, but by request rather than import, so it still loads with either off.
 *
 * The second half is the runtime matrix. An allowed edge is a channel the lower extension
 * answers, so every `answerOn` registration has to live in the bus — a listener anywhere else
 * would be an upward call dressed as a request.
 *
 * The third is a served page's namespace: a prefix belongs to the page that claims it, and
 * another page spelling it is a link into a route mounted only while that page is open.
 */

import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { posixPath } from "./helpers/files.ts";
import {
	dirsOf,
	extensionsDir,
	filesIn,
	libDir,
	relative,
	repo,
	sourceFiles,
	textOf,
	testDir,
} from "./helpers/scan.ts";

/** A static specifier, from `from "x"`, `import "x"`, or `import("x")`. */
const SPEC = /(?:\bfrom\b|\bimport\s*\(?)\s*["']([^"']+)["']/;

/**
 * The old domain directory name, assembled so this file's own text does not match the scan
 * that proves the name is gone from everywhere else.
 */
const OLD_DOMAIN = ["lib", "board"].join("/");

interface Edge {
	/** The importing file, relative to the repository. */
	file: string;
	line: number;
	/** The imported module, relative to the repository. */
	to: string;
}

/** Every relative import under `root`, resolved to a repository-relative path. */
function edgesOf(root: string): Edge[] {
	const edges: Edge[] = [];
	for (const file of filesIn(root).filter((name) => name.endsWith(".ts"))) {
		const dir = file.slice(0, file.lastIndexOf("/"));
		textOf(file)
			.split("\n")
			.forEach((line, index) => {
				const spec = SPEC.exec(line)?.[1];
				if (spec === undefined || !spec.startsWith(".")) return;
				const resolved = posixPath(join(dir, spec));
				edges.push({ file: relative(file), line: index + 1, to: resolved.slice(repo.length + 1) });
			});
	}
	return edges;
}

/** The edges under one extension that land in a place the layer matrix forbids. */
function offenders(from: string, forbidden: readonly string[]): string[] {
	return edgesOf(join(extensionsDir, from))
		.filter((edge) => forbidden.some((prefix) => edge.to.startsWith(prefix)))
		.map((edge) => `${edge.file}:${edge.line}: imports ${edge.to} — ${from} may not reach that layer`);
}

describe("the dependency layers", () => {
	test("the bus is the floor: no workflow rule and no other extension", () => {
		// A bus that knew a card, or another extension, could not be the transport the other two
		// keep working without — and its independence row would be a lie. Its own modules are of
		// course in `extensions/session-bus/`; every other extension is what the rule forbids.
		const others = dirsOf(extensionsDir)
			.filter((name) => name !== "session-bus")
			.map((name) => `extensions/${name}/`);
		expect(offenders("session-bus", [...others, "lib/workflow/"])).toEqual([]);
	});

	test("team uses the domain and never board", () => {
		expect(offenders("team", ["extensions/board/"])).toEqual([]);
	});

	test("the domain imports no extension", () => {
		const offenders = edgesOf(join(libDir, "workflow"))
			.filter((edge) => edge.to.startsWith("extensions/"))
			.map((edge) => `${edge.file}:${edge.line}: imports ${edge.to} — lib/ is below every extension`);
		expect(offenders).toEqual([]);
	});

	test("board reaches the other two by request, not by import", () => {
		// The edge is permitted; the form is not. A static import would make the page and the
		// tool unloadable with team or the bus switched off, which the independence rows forbid.
		expect(offenders("board", ["extensions/team/", "extensions/session-bus/"])).toEqual([]);
	});

	test("the old domain name is gone from every source and page but the changelog", () => {
		// The changelog is history: its bullets describe the tree as it was, and rewriting them
		// would make an old entry cite a path that did not exist when it landed.
		const files = [
			...filesIn(libDir),
			...filesIn(extensionsDir),
			...filesIn(testDir),
			...filesIn(join(repo, "docs")),
			join(repo, "AGENTS.md"),
			join(repo, "CONTRIBUTING.md"),
			join(repo, "README.md"),
		].filter((file) => file.endsWith(".ts") || file.endsWith(".md"));
		const stale = files.filter((file) => textOf(file).includes(OLD_DOMAIN)).map(relative);
		expect(stale).toEqual([]);
	});

	test("a served prefix is spelled only by the page that claims it", () => {
		// Two pages answer on the session's one origin, and each prefix is mounted only while its
		// own page is open: a link across them 404s whenever the other page is not serving. One row
		// per pair — a page that starts naming a third prefix adds its line.
		const OWNED: ReadonlyArray<{ owner: string; foreign: string }> = [
			{ owner: "code-review", foreign: "/files" },
			{ owner: "file-browse", foreign: "/review" },
		];
		// Source can spell it with either quote or inside a template, so all three count.
		const spellings = (foreign: string): string[] => [`"${foreign}`, `'${foreign}`, `\`${foreign}`];
		const offenders = OWNED.flatMap(({ owner, foreign }) =>
			sourceFiles(join(extensionsDir, owner))
				.filter((file) => spellings(foreign).some((spelling) => textOf(file).includes(spelling)))
				.map((file) => `${relative(file)} spells ${foreign}, which another page owns`),
		);
		expect(offenders).toEqual([]);
	});
});

describe("the request matrix", () => {
	/** Every channel the caller side exports: each is a question asked downward. */
	const CHANNELS = ["TEAM_JOIN_REQUEST", "SESSION_SEND_REQUEST", "SESSION_CLAIM_REQUEST", "SESSION_RELEASE_REQUEST"];

	/** The bus's own source, joined once: the one place a channel may be answered. */
	function busText(): string {
		return filesIn(join(extensionsDir, "session-bus"))
			.filter((file) => file.endsWith(".ts"))
			.map(textOf)
			.join("\n");
	}

	test("each channel is named only by the caller side and the bus", () => {
		// The caller side declares the channel; the bus answers it. A third file naming one would
		// be either an upward listener or a second owner of the envelope, and both are the edge
		// this matrix exists to prevent.
		const files = [...sourceFiles(libDir), ...sourceFiles(extensionsDir)];
		for (const channel of CHANNELS) {
			const stray = files
				.filter((file) => textOf(file).includes(channel))
				.map(relative)
				.filter((file) => file !== "lib/session-tool.ts" && !file.startsWith("extensions/session-bus/"));
			expect(stray, `${channel} is named outside the caller side and the bus`).toEqual([]);
		}
	});

	test("the caller side exports the channels the bus answers", () => {
		const caller = textOf(join(libDir, "session-tool.ts"));
		for (const channel of CHANNELS) {
			expect(caller).toContain(`export const ${channel} `);
			expect(busText()).toContain(channel);
		}
	});

	test("the domain and the page ask by channel rather than owning one", () => {
		// A channel named for a board or team listener would be the upward edge the matrix
		// forbids; the caller side's exports are the closed list of questions asked.
		const caller = textOf(join(libDir, "session-tool.ts"));
		const named = [...caller.matchAll(/export const ([A-Z_]+_REQUEST)\b/g)].map((match) => match[1]).sort();
		expect(named).toEqual([...CHANNELS].sort());
	});
});
