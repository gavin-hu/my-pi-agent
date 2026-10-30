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
 * Every extension loads in one process on purpose. Pi gives each extension its own
 * module cache, so sharing one here is the strictest case: `lib/` is value-only
 * by invariant, and a module-level value there would surface as a cross-extension
 * failure instead of a subtle reload bug.
 *
 * The same load answers the size claims the entry READMEs and the user guide make
 * when a reader weighs the pack: the extension, tool, skill, and theme counts are
 * derived here and compared with what those pages state.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";
import { ROOT_TOOL_NAMES } from "../extensions/worktree/root-tools.ts";
import { posix, walkFiles } from "./helpers/files.ts";
import { ALL_EXTENSIONS_ENV, withAgentDir, withEnv } from "./helpers/env.ts";
import { createFakePi } from "./helpers/fakes.ts";

const root = join(import.meta.dir, "..");

/** The extension entry files the package manifest declares. */
const manifest: string[] = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).pi.extensions;

/** Every directory under `extensions/`, as a manifest entry. */
function declaredFromDisk(): string[] {
	return extensionNames().map((name) => `./extensions/${name}/index.ts`);
}

/** Every directory under `extensions/`, by name. */
function extensionNames(): string[] {
	return readdirSync(join(root, "extensions"))
		.filter((name) => statSync(join(root, "extensions", name)).isDirectory())
		.sort();
}

/** Every packaged skill, found on disk: one `SKILL.md` per skill directory. */
function skillFiles(): string[] {
	return walkFiles(join(root, "skills")).filter((file) => file.endsWith("/SKILL.md"));
}

/** The skill directory a `SKILL.md` sits in, as the README links it. */
function skillName(file: string): string {
	return file.slice(posix(join(root, "skills")).length + 1).split("/")[0];
}

/** Every theme the package ships. */
function themeFiles(): string[] {
	return readdirSync(join(root, "themes")).filter((name) => name.endsWith(".json"));
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

	test("names every extension directory in the description", () => {
		const { description = "" } = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as {
			description?: string;
		};
		const missing = extensionNames().filter((name) => !description.includes(name));
		expect(missing, "package.json description does not name these extensions").toEqual([]);
	});
});

describe("skill manifest", () => {
	const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as {
		files?: string[];
		pi?: { skills?: string[] };
	};

	test("declares and publishes the packaged skills", () => {
		expect(pkg.pi?.skills).toContain("./skills");
		expect(pkg.files).toContain("skills/**");

		const skills = skillFiles();
		expect(skills.length).toBeGreaterThan(0);
		for (const file of skills) {
			expect(readFileSync(file, "utf-8"), file).toMatch(/^---\nname: [a-z0-9-]+\ndescription: /);
		}
	});

	// The entry READMEs are the catalog: a skill with no row is a workflow nobody
	// finds, so the row ships with the skill. The reverse — a row naming a skill
	// that is not on disk — is caught by `test/doc-links.test.ts`'s check.
	test("gives every packaged skill a row in both entry READMEs", () => {
		const pages = ["README.md", "README.zh-CN.md"].map((page) => ({
			page,
			text: readFileSync(join(root, page), "utf-8"),
		}));
		const missing = skillFiles().flatMap((file) =>
			pages
				.filter(({ text }) => !text.includes(`](./skills/${skillName(file)}/SKILL.md)`))
				.map(({ page }) => `${file}: no row in ${page}`),
		);
		expect(missing, "a packaged skill the entry READMEs do not list").toEqual([]);
	});
});

describe("every extension loads through the fake runtime", () => {
	for (const entry of manifest) {
		test(entry, async () => {
			const module = (await import(join(root, entry))) as { default?: unknown };
			expect(typeof module.default).toBe("function");

			// A fresh double per extension, a temp agent directory so no extension can
			// read or write the real one, and the environment that loads the whole pack:
			// nothing disabled, every opt-in extension named.
			await withAgentDir(async () => {
				await withEnv(ALL_EXTENSIONS_ENV, () => {
					const fake = createFakePi();
					(module.default as (pi: unknown) => void)(fake.pi);
					expect(registrations(fake)).toBeGreaterThan(0);
				});
			});
		});
	}
});

/** The factories run once per file, and the size test reads the same result. */
let toolsPromise: Promise<Set<string>> | undefined;

/** Load every manifest extension and collect the tools it registers. */
function registeredTools(): Promise<Set<string>> {
	toolsPromise ??= (async () => {
		const tools = new Set<string>();
		for (const entry of manifest) {
			const module = (await import(join(root, entry))) as { default?: (pi: unknown) => void };
			await withAgentDir(async () => {
				await withEnv(ALL_EXTENSIONS_ENV, () => {
					const fake = createFakePi();
					module.default?.(fake.pi);
					for (const name of fake.tools.keys()) tools.add(name);
				});
			});
		}
		return tools;
	})();
	return toolsPromise;
}

/** The kinds of thing a page can say the pack has. */
type Noun = "extensions" | "tools" | "skills" | "themes";

describe("the documented footprint", () => {
	/** The pages that state how big the pack is, where a reader weighs it. */
	const pages = [join(root, "README.md"), join(root, "README.zh-CN.md"), join(root, "docs", "architecture.md")].map(
		(file) => ({ file: relative(root, file), text: readFileSync(file, "utf-8") }),
	);

	/** A size a page states: `17 extensions`, `22 tools`, `17 个扩展`, `2 个随包技能`. */
	const CLAIM = /(\d+)\s*(extensions|tools|skills|themes|个(?:随包)?(?:扩展|技能|工具|主题))(?![a-z0-9])/g;

	/** The fact a stated noun counts, in either language. */
	const NOUNS = new Map<string, Noun>([
		["extensions", "extensions"],
		["个扩展", "extensions"],
		["个随包扩展", "extensions"],
		["tools", "tools"],
		["个工具", "tools"],
		["skills", "skills"],
		["个技能", "skills"],
		["个随包技能", "skills"],
		["themes", "themes"],
		["个主题", "themes"],
	]);

	test("every count a page states is what the package actually loads", async () => {
		const names = await registeredTools();

		// Pi's path tools are re-registered by `worktree` so they follow the active
		// root. They replace the model's existing tool of the same name rather than
		// joining the list, so they are not part of what the pack adds.
		const overridden = new Set<string>(ROOT_TOOL_NAMES);
		const added = [...names].filter((name) => !overridden.has(name));

		const actual: Record<Noun, number> = {
			extensions: manifest.length,
			tools: added.length,
			skills: skillFiles().length,
			themes: themeFiles().length,
		};

		const claimed = new Set<Noun>();
		for (const { file, text } of pages) {
			for (const [, count, spelling] of text.matchAll(CLAIM)) {
				const noun = NOUNS.get(spelling);
				if (noun === undefined) throw new Error(`${file} states a size with an unknown noun: ${spelling}`);
				claimed.add(noun);
				expect(Number(count), `${noun} stated in ${file}`).toBe(actual[noun]);
			}
		}

		// A noun no page states would make the assertions above vacuous for it. No
		// page states a tool count, so the three the catalog carries are the check.
		expect([...claimed].sort(), "a size fact no page states").toEqual(["extensions", "skills", "themes"]);
	});
});
