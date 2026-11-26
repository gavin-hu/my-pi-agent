/**
 * Screenshot the browser code review page with headless Chrome (dev tooling).
 *
 * Builds a throwaway repository in a temporary directory, serves it through the
 * shipped review page — the same mount, routes, bundle, and stylesheet a
 * `code_review open` serves — posts two comments through the real write route, and
 * writes a full-page PNG. The fixture's names are invented, so the image never
 * describes a real checkout.
 *
 *   bun run capture:code-review [-o out.png] [--width 1280] [--scale 2]
 *     [--theme light|dark] [--wait 8000]
 *
 * Output defaults to `code-review.png` in the working directory. `PI_CHROME`
 * selects a Chrome or Chromium other than the macOS default.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_REVIEW_CONFIG } from "../../extensions/code-review/config/config.ts";
import { createReviewCurrent, type ReviewCurrent } from "../../extensions/code-review/review/current.ts";
import { createReviewStore } from "../../extensions/code-review/review/store.ts";
import { createReviewPage } from "../../extensions/code-review/transport/server.ts";
import { presetScope } from "../../extensions/code-review/scope.ts";
import { testMountSource } from "../../test/helpers/serve.ts";
import { ENV_ROOT } from "../../lib/env.ts";
import { type PageShotOptions, capturePage } from "../capture/page.ts";
import { parseShotArgs, runCli } from "../cli.ts";

/** CLI options after parsing. */
export type ShotOptions = PageShotOptions;

/** Parse the command line; throws a message the caller prints as usage. */
export function parseArgs(argv: string[]): ShotOptions {
	const parsed = parseShotArgs(argv, { out: "code-review.png", scale: 2, maxPositional: 0 });
	return {
		out: resolve(parsed.out || "code-review.png"),
		width: parsed.width,
		scale: parsed.scale,
		theme: parsed.theme,
		waitMs: parsed.waitMs,
	};
}

/** The base every capture starts from: one file, committed. */
const GATEWAY = `import { serve } from "./server.ts";

/** Start the gateway on the configured port. */
export function start(port: number): void {
  serve({ port, routes: [] });
}
`;

/** The branch the review reads: a guard added to `start`, and a new module. */
const GATEWAY_AFTER = `import { serve } from "./server.ts";
import { limitOf } from "./limits.ts";

/** Start the gateway on the configured port. */
export function start(port: number): void {
  const limit = limitOf(port);
  if (limit === 0) throw new RangeError("the gateway needs a port");
  serve({ port, routes: [], limit });
}
`;

const LIMITS = `/** The largest request the gateway accepts on a port. */
export function limitOf(port: number): number {
  return port < 1024 ? 0 : 1024;
}
`;

/** Run git in the fixture, with an identity of its own so no config is needed. */
function git(cwd: string, args: string[]): void {
	execFileSync("git", args, {
		cwd,
		stdio: "ignore",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Aurora",
			GIT_AUTHOR_EMAIL: "aurora@example.com",
			GIT_COMMITTER_NAME: "Aurora",
			GIT_COMMITTER_EMAIL: "aurora@example.com",
			GIT_CONFIG_COUNT: "1",
			GIT_CONFIG_KEY_0: "core.autocrlf",
			GIT_CONFIG_VALUE_0: "false",
		},
	});
}

/** The fixture repository: `main` with one file, and a branch that changes two. */
export function buildFixture(): string {
	// A fixture is not a session: the worktree override is the environment's answer about which tree a
	// *session* is in, and a capture's page is served from the tree this function builds. Left in place it
	// stands in for the fixture, because `createReviewCurrent`'s place resolves the directory it is given
	// through `effectiveRealCwd` — so the run would photograph whatever checkout the session was in, and
	// die later on a comment the wrong diff cannot anchor (#927).
	delete process.env[ENV_ROOT];
	const dir = mkdtempSync(join(tmpdir(), "pi-review-shot-"));
	git(dir, ["init", "-q", "-b", "main"]);
	writeFileSync(join(dir, "README.md"), "# Aurora Gateway\n\nOne binary, one config file, no plugins.\n");
	writeFileSync(join(dir, "gateway.ts"), GATEWAY);
	git(dir, ["add", "."]);
	git(dir, ["commit", "-qm", "the gateway skeleton"]);
	git(dir, ["checkout", "-q", "-b", "serve-limits"]);
	writeFileSync(join(dir, "gateway.ts"), GATEWAY_AFTER);
	writeFileSync(join(dir, "limits.ts"), LIMITS);
	writeFileSync(
		join(dir, "README.md"),
		"# Aurora Gateway\n\nOne binary, one config file, no plugins.\nThe port sets the limit.\n",
	);
	git(dir, ["add", "."]);
	git(dir, ["commit", "-qm", "refuse a port the gateway cannot serve"]);
	return dir;
}

/** Post one write through the page's real route on the socket it serves. */
async function post(page: { url: string }, path: string, body: unknown): Promise<void> {
	const response = await fetch(new URL(`/review${path}`, page.url), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!response.ok) throw new Error(`the fixture write was refused: ${await response.text()}`);
}

/** The review the shot draws from `dir`: the fixture's own checkout, and the page's one store. */
export function fixtureReview(dir: string): { store: ReturnType<typeof createReviewStore>; current: ReviewCurrent } {
	const exec = async (command: string, args: string[], callOptions: { cwd?: string } = {}) => {
		try {
			const stdout = execFileSync(command, args, { cwd: callOptions.cwd ?? dir, encoding: "utf-8" });
			return { stdout, stderr: "", code: 0, killed: false, truncated: false };
		} catch (error) {
			const failure = error as { stdout?: string; stderr?: string; status?: number };
			return {
				stdout: failure.stdout ?? "",
				stderr: failure.stderr ?? "",
				code: failure.status ?? 1,
				killed: false,
				truncated: false,
			};
		}
	};
	const store = createReviewStore();
	const current = createReviewCurrent({
		store,
		exec: { exec },
		config: { ...DEFAULT_REVIEW_CONFIG, base: "main", maxFiles: 20, maxDiffLines: 400 },
		cwd: () => dir,
	});
	return { store, current };
}

/** The capture: a repository, the shipped page over it, two comments, one PNG. */
export async function capture(options: ShotOptions): Promise<void> {
	const dir = buildFixture();
	const { store, current } = fixtureReview(dir);
	const outcome = await createReviewPage({
		store,
		current,
		session: "screenshot",
		mount: testMountSource(),
	});
	if (outcome.kind === "refused") {
		rmSync(dir, { recursive: true, force: true });
		throw new Error(outcome.reason);
	}
	const page = outcome.page;
	const scope = presetScope("change", "main");
	if (scope === undefined) throw new Error("the change preset has no default to resolve");
	await current.openPage(scope, "change");
	const held = page.store.current();
	const snapshot = await page.snapshot();
	if (held === undefined || snapshot.kind !== "snapshot") throw new Error("the fixture has no diff to review");
	const frame = { token: held.token, rev: snapshot.snapshot.fingerprint };
	const ready = `(function () {
		var rail = document.querySelector(".rv-rail");
		var thread = document.querySelector(".rv-thread");
		return !!document.getElementById("rv-data") && !!rail && !!thread;
	})()`;
	try {
		await post(page, "/api/comment", {
			...frame,
			comment: {
				rel: "gateway.ts",
				line: 6,
				side: "new",
				body: "Name the bound where the caller can read it: `limitOf` returns `0`, which this reads as invalid rather than as a limit.",
			},
		});
		await post(page, "/api/comment", {
			...frame,
			comment: {
				rel: "gateway.ts",
				line: 7,
				side: "new",
				body: "The throw is right, but the sentence should name the port it refused.",
			},
		});
		await post(page, "/api/reviewed", { ...frame, rel: "limits.ts", reviewed: true });
		await capturePage({
			url: page.url,
			out: options.out,
			width: options.width,
			scale: options.scale,
			theme: options.theme,
			waitMs: options.waitMs,
			ready,
		});
	} finally {
		await page.close();
		rmSync(dir, { recursive: true, force: true });
	}
}

const USAGE = `usage: bun run capture:code-review [-o out.png] [--width 1280] [--scale 2] [--theme light|dark] [--wait 8000]`;

if (import.meta.main) {
	runCli(USAGE, async () => {
		const options = parseArgs(process.argv.slice(2));
		await capture(options);
		console.log(options.out);
	});
}
