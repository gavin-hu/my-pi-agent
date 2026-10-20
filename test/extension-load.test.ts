/**
 * Load guard: every extension the `pi` manifest lists loads through the fake
 * runtime.
 *
 * This is the registration half of the compatibility floor. The `compat` CI job
 * proves the suite against the newest published Pi; this test is what catches a
 * host change that breaks *loading* — a removed field, a renamed registration
 * call, a factory that no longer only registers — on every platform and on every
 * pull request, where the newest-peer job deliberately does not run.
 *
 * It is driven by `package.json`'s `pi.extensions`, not a hand list, so a new
 * extension that never reaches the manifest fails here too: an extension the
 * manifest does not name is invisible to a user, and an entry pointing at a
 * missing file fails the load for everyone.
 *
 * All sixteen load in one process on purpose. Pi gives each extension its own
 * module cache, so sharing one here is the strictest case: `lib/` is value-only
 * by invariant, and a module-level value there would surface as a cross-extension
 * failure instead of a subtle reload bug.
 *
 * The same load answers the size claim the user guide makes when a
 * reader weighs the pack: the extension and tool counts are derived here and
 * compared with what that page states.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { ROOT_TOOL_NAMES } from "../extensions/worktree/root-tools.ts";
import { ENV_DISABLED_EXTENSIONS } from "../lib/env.ts";
import { withAgentDir, withEnv } from "./helpers/env.ts";
import { createFakePi } from "./helpers/fakes.ts";

const root = join(import.meta.dir, "..");

/** The extension entry files the package manifest declares. */
const manifest: string[] = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).pi.extensions;

/** Every directory under `extensions/`, as a manifest entry. */
function declaredFromDisk(): string[] {
	return readdirSync(join(root, "extensions"))
		.filter((name) => statSync(join(root, "extensions", name)).isDirectory())
		.map((name) => `./extensions/${name}/index.ts`)
		.sort();
}

/** How many things a factory registered for the host to hold. */
function registrations(fake: ReturnType<typeof createFakePi>): number {
	return (
		fake.tools.size +
		fake.commands.size +
		fake.flags.size +
		fake.shortcuts.size +
		fake.handlers.size +
		fake.renderers.size +
		fake.messageRenderers.size +
		fake.toolRenderers.length +
		fake.markdownTransformers.length
	);
}

describe("extension manifest", () => {
	test("lists every extension directory, and only those", () => {
		expect([...manifest].sort()).toEqual(declaredFromDisk());
	});

	test("points every entry at a file that exists", () => {
		const missing = manifest.filter((entry) => !existsSync(join(root, entry)));
		expect(missing).toEqual([]);
	});
});

describe("every extension loads through the fake runtime", () => {
	for (const entry of manifest) {
		test(entry, async () => {
			const module = (await import(join(root, entry))) as { default?: unknown };
			expect(typeof module.default).toBe("function");

			// A fresh double per extension, a temp agent directory so no extension can
			// read or write the real one, and no inherited disabled list.
			await withAgentDir(async () => {
				await withEnv({ [ENV_DISABLED_EXTENSIONS]: "" }, () => {
					const fake = createFakePi();
					(module.default as (pi: unknown) => void)(fake.pi);
					expect(registrations(fake)).toBeGreaterThan(0);
				});
			});
		});
	}
});

describe("the documented footprint", () => {
	/** The page that states how big the pack is, where a reader decides on it. */
	const guide = readFileSync(join(root, "docs", "user-guide.md"), "utf-8");
	/** A size the guide states: `16 extensions`, `21 tools`. */
	const CLAIM = /(\d+) (extensions|tools)\b/g;

	test("every count in the guide is what actually loads", async () => {
		const names = new Set<string>();
		for (const entry of manifest) {
			const module = (await import(join(root, entry))) as { default?: (pi: unknown) => void };
			await withAgentDir(async () => {
				await withEnv({ [ENV_DISABLED_EXTENSIONS]: "" }, () => {
					const fake = createFakePi();
					module.default?.(fake.pi);
					for (const name of fake.tools.keys()) names.add(name);
				});
			});
		}

		// Pi's path tools are re-registered by `worktree` so they follow the active
		// root. They replace the model's existing tool of the same name rather than
		// joining the list, so they are not part of what the pack adds.
		const overridden = new Set<string>(ROOT_TOOL_NAMES);
		const added = [...names].filter((name) => !overridden.has(name));

		const actual: Record<string, number> = { extensions: manifest.length, tools: added.length };
		const claims = [...guide.matchAll(CLAIM)];
		// A regex that stopped matching would make the loop below vacuous.
		expect(claims.length).toBeGreaterThan(0);
		for (const [, count, noun] of claims) {
			expect(Number(count), `${noun} stated in docs/user-guide.md`).toBe(actual[noun]);
		}
	});
});
