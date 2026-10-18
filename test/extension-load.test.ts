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
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
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
