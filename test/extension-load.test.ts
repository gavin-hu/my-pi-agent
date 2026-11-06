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

/** `package.json`, which states what the host supplies and what this pack loads. */
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as {
	pi: { extensions: string[] };
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
};

/** The extension entry files the package manifest declares. */
const manifest: string[] = pkg.pi.extensions;

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
			// read or write the real one, and the environment that loads the whole pack;
			// nothing disabled.
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

/**
 * What a registration has to carry to reach the model on purpose rather than on Pi's
 * restrictive default: the annotations `AGENTS.md` requires, and the snippet it names.
 */
export interface RegisteredTool {
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
	promptSnippet?: string;
}

/** One registration, with the manifest entry that made it, so a failure can name both. */
interface Registration {
	entry: string;
	tool: RegisteredTool;
}

/** The factories run once per file, and every reader below shares the result. */
let toolsPromise: Promise<Map<string, Registration>> | undefined;

/** Load every manifest extension and collect the tools it registers, by name. */
function registeredToolMap(): Promise<Map<string, Registration>> {
	toolsPromise ??= (async () => {
		const tools = new Map<string, Registration>();
		for (const entry of manifest) {
			const module = (await import(join(root, entry))) as { default?: (pi: unknown) => void };
			await withAgentDir(async () => {
				await withEnv(ALL_EXTENSIONS_ENV, () => {
					const fake = createFakePi();
					module.default?.(fake.pi);
					for (const [name, tool] of fake.tools) tools.set(name, { entry, tool: tool as RegisteredTool });
				});
			});
		}
		return tools;
	})();
	return toolsPromise;
}

/** The entries that are Pi's own path tools, re-registered rather than added. */
const pathTools = new Set<string>(ROOT_TOOL_NAMES);

/** The tools this pack adds to the model's surface, which is what the guards below hold. */
async function addedTools(): Promise<Array<[string, Registration]>> {
	return [...(await registeredToolMap())].filter(([name]) => !pathTools.has(name));
}

/** The kinds of thing a page can say the pack has. */
type Noun = "extensions" | "tools" | "skills" | "themes";

describe("the tool surface", () => {
	test("every added tool declares its hints, its snippet, and a destructive hint when it mutates", async () => {
		const offenders: string[] = [];
		for (const [name, { entry, tool }] of await addedTools()) {
			const { readOnlyHint, destructiveHint, openWorldHint } = tool.annotations ?? {};
			if (typeof readOnlyHint !== "boolean")
				offenders.push(`${entry}: \`${name}\` declares no annotations.readOnlyHint`);
			if (typeof openWorldHint !== "boolean")
				offenders.push(`${entry}: \`${name}\` declares no annotations.openWorldHint`);
			if (readOnlyHint === false && typeof destructiveHint !== "boolean") {
				offenders.push(`${entry}: \`${name}\` mutates but declares no annotations.destructiveHint`);
			}
			if ((tool.promptSnippet ?? "").trim() === "") {
				offenders.push(`${entry}: \`${name}\` declares no promptSnippet`);
			}
		}
		expect(offenders, "every tool states what the model may assume about it").toEqual([]);
	});
});

describe("the host packages", () => {
	/** A package the Pi host supplies rather than this one shipping: `AGENTS.md`'s peer rule. */
	const supplied = (name: string): boolean => name.startsWith("@earendil-works/pi-") || name === "typebox";

	test("the host supplies every peer, so a peer is unbounded and never a runtime dependency", () => {
		const offenders: string[] = [];
		for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
			if (!supplied(name)) offenders.push(`package.json: \`${name}\` is a peer but not a package the Pi host supplies`);
			if (range !== "*") {
				offenders.push(`package.json: \`${name}\` is pinned to ${range}; the host supplies it, so the range is \`*\``);
			}
		}
		for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
			if (!supplied(name)) continue;
			offenders.push(`package.json: \`${name}\`@${range} is a runtime dependency; a second copy must not ship`);
		}
		expect(offenders, "a pinned or duplicated host package breaks a user on another Pi").toEqual([]);
	});

	test("every package the host supplies is declared as a peer", () => {
		const peers = new Set(Object.keys(pkg.peerDependencies ?? {}));
		const missing = Object.keys(pkg.dependencies ?? {})
			.filter(supplied)
			.filter((name) => !peers.has(name));
		expect(missing).toEqual([]);
	});
});

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
		// Pi's path tools are re-registered by `worktree` so they follow the active
		// root. They replace the model's existing tool of the same name rather than
		// joining the list, so they are not part of what the pack adds.
		const tools = await addedTools();

		const actual: Record<Noun, number> = {
			extensions: manifest.length,
			tools: tools.length,
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
