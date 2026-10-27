/**
 * Screenshot the loopback file browser with headless Chrome (dev tooling).
 *
 * Serves a directory through the shipped server — the same router, client
 * bundle, theme runtime, and Markdown renderer a `/browse` session serves — and
 * writes a full-page PNG of one file's page, so the document's layout can be
 * checked without opening a browser by hand.
 *
 * Without `--root` it builds a throwaway project in a temporary directory and
 * serves that: the page prints the served root in its header and footer, so the
 * image must not name a real checkout or someone's files. `PI_CHROME` selects a
 * Chrome or Chromium other than the macOS default.
 *
 *   bun run screenshot:file-browse [--root <dir>] [--file <rel>] [-o out.png]
 *     [--width 1280] [--scale 1] [--theme light|dark] [--wait 8000]
 *
 * Output defaults to `file-browse.png` in the working directory.
 */

import { execFile, execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "../../extensions/file-browse/config/config.ts";
import { createGitDiff, createGitStatus } from "../../extensions/file-browse/git/git.ts";
import { encodePath } from "../../extensions/file-browse/files/paths.ts";
import { createFileServer } from "../../extensions/file-browse/transport/server.ts";
import { testMountSource } from "../../test/helpers/serve.ts";
import { parseShotArgs, runCli } from "../cli.ts";
import { type PageShotOptions, capturePage } from "../capture/page.ts";

/** CLI options after parsing. */
export interface ShotOptions extends PageShotOptions {
	/** Directory to serve; absent builds the fixture project. */
	root?: string;
	/** Root-relative file whose page is captured. */
	file: string;
}

/** Parse the command line; throws a message the caller prints as usage. */
export function parseArgs(argv: string[]): ShotOptions {
	const parsed = parseShotArgs(argv, {
		out: "file-browse.png",
		scale: 1,
		extraFlags: ["--root", "--file"],
		maxPositional: 0,
	});
	const root = parsed.values["--root"] ?? "";
	const file = parsed.values["--file"] ?? "README.md";
	if (file.startsWith("/")) throw new Error("--file must be root-relative");
	return {
		root: root ? resolve(root) : undefined,
		file,
		out: resolve(parsed.out || "file-browse.png"),
		width: parsed.width,
		scale: parsed.scale,
		theme: parsed.theme,
		waitMs: parsed.waitMs,
	};
}

/**
 * The generated project's files. Every name, domain, and endpoint is invented:
 * the capture is documentation, so it must not describe a real service.
 */
const FIXTURE_FILES: Record<string, string> = {
	"README.md": [
		"# Aurora Gateway",
		"",
		"A small, dependency-free API gateway that fronts a handful of internal services. It is intentionally boring: one binary, one config file, no plugins.",
		"",
		"## Quick start",
		"",
		"Install the binary and point it at a config file:",
		"",
		"```bash",
		"curl -fsSL https://example.com/install.sh | sh",
		"aurora serve --config ./aurora.toml",
		"```",
		"",
		"The gateway listens on `8787` by default and proxies every route under `/api/` to the upstream named in the config.",
		"",
		"## Configuration",
		"",
		"| key | type | default | purpose |",
		"|---|---|---|---|",
		"| `listen` | string | `127.0.0.1:8787` | Bind address for the HTTP listener |",
		"| `upstreams` | table | `{}` | Named upstream base URLs |",
		"| `rateLimit` | table | `{ rate = 20, burst = 40 }` | Default bucket per API key |",
		"| `logFormat` | string | `json` | `json` or `text` |",
		"",
		"See the [operations guide](docs/guide.md) for the rollout checklist.",
		"",
		"## License",
		"",
		"MIT. See [LICENSE](LICENSE) for the full text.",
		"",
		"## Notes",
		"",
		"Keep the burst low enough that a single client cannot hold the pool.",
		"",
		"## Operations",
		"",
		"See [`docs/guide.md`](docs/guide.md).",
	].join("\n"),
	"docs/guide.md": [
		"# Operations guide",
		"",
		"## Rollout",
		"",
		"1. Drain the pool before replacing the binary.",
		"2. Point the health check at `/healthz`, not `/api/`.",
		"3. Watch the 5xx rate for ten minutes.",
		"",
		"## Config changes",
		"",
		"Restart the gateway after editing the config; there is no hot reload.",
	].join("\n"),
	"src/gateway.ts": [
		"export interface Upstream {",
		"\tname: string;",
		"\tbaseUrl: string;",
		"}",
		"",
		"export function routeFor(path: string, upstreams: Upstream[]): Upstream | undefined {",
		'\tconst [, name] = path.split("/");',
		"\treturn upstreams.find((upstream) => upstream.name === name);",
		"}",
	].join("\n"),
	"public/index.html": [
		"<!doctype html>",
		'<html lang="en">',
		"\t<head>",
		'\t\t<meta charset="utf-8">',
		"\t\t<title>Aurora Gateway</title>",
		"\t</head>",
		"\t<body>",
		"\t\t<p>Nothing here yet.</p>",
		"\t</body>",
		"</html>",
	].join("\n"),
};

/** The uncommitted edit, so the page's header shows a real change count. */
const FIXTURE_CHANGE = [
	"",
	"## Draining",
	"",
	"Send `SIGTERM` and the listener stops accepting new connections while in-flight requests finish.",
	"",
].join("\n");

/** Write the fixture project and commit it, leaving one file modified. */
function createFixture(): string {
	// macOS `tmpdir()` is a long per-user /var/folders path and the page prints the
	// served root, so use the short, obviously temporary /private/tmp there.
	const base = process.platform === "darwin" ? "/private/tmp" : tmpdir();
	const root = mkdtempSync(join(base, "aurora-gateway-"));
	for (const [rel, content] of Object.entries(FIXTURE_FILES)) {
		const path = join(root, ...rel.split("/"));
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}
	// A local identity, so neither the commit nor the rendered dates depend on
	// the machine's gitconfig.
	git(root, ["init", "-q", "-b", "main"]);
	git(root, ["add", "-A"]);
	git(root, [
		"-c",
		"user.name=Pi Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"commit",
		"-qm",
		"Add the Aurora Gateway",
	]);
	appendFileSync(join(root, "docs", "guide.md"), FIXTURE_CHANGE);
	return root;
}

/** Run one git command in the fixture, failing the shot when it fails. */
function git(root: string, args: string[]): void {
	execFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "ignore", "pipe"] });
}

/**
 * The git providers shell out through `pi.exec`; this is the only seam the shot
 * needs, so a small `execFile` wrapper stands in for the host.
 */
function execApi(): Pick<ExtensionAPI, "exec"> {
	return {
		exec: (command, args, options) =>
			new Promise((settle) => {
				execFile(
					command,
					args,
					{ cwd: options?.cwd, timeout: options?.timeout ?? 0, maxBuffer: 8 * 1024 * 1024 },
					(error, stdout, stderr) => {
						const code = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
						settle({ stdout, stderr, code, killed: false });
					},
				);
			}),
	};
}

/** The page is ready once the sidebar and the rendered Markdown are both drawn. */
const READY = `(function () {
	var article = document.querySelector("article.bf-md");
	return !!document.getElementById("filter") && !!article && (article.textContent || "").trim().length > 0;
})()`;

/** Serve one directory and capture one file page. */
async function capture(options: ShotOptions): Promise<void> {
	const fixture = options.root ? undefined : createFixture();
	const root = options.root ?? (fixture as string);
	const api = execApi();
	// The page mounts on a server of its own, which is what `serve` gives it at runtime;
	// the shot does not need a session behind it.
	const outcome = await createFileServer({
		root,
		config: { ...DEFAULT_CONFIG, autoOpen: false },
		mount: testMountSource(),
		session: "screenshot",
		git: createGitStatus(api, root),
		diff: createGitDiff(api, root, {}),
	});
	if (outcome.kind !== "served") throw new Error(outcome.reason);
	const server = outcome.server;
	try {
		await capturePage({
			url: new URL(`view/${encodePath(options.file)}`, server.url).toString(),
			out: options.out,
			width: options.width,
			scale: options.scale,
			theme: options.theme,
			waitMs: options.waitMs,
			ready: READY,
		});
	} finally {
		await server.close();
		if (fixture) rmSync(fixture, { recursive: true, force: true });
	}
}

const USAGE = `usage: bun run screenshot:file-browse [--root <dir>] [--file <rel>] [-o out.png] [--width 1280] [--scale 1] [--theme light|dark] [--wait 8000]`;

if (import.meta.main) {
	runCli(USAGE, async () => {
		const options = parseArgs(process.argv.slice(2));
		await capture(options);
		console.log(options.out);
	});
}
