/**
 * The runtime prerequisites each extension declares.
 *
 * `REQUIREMENTS` in `lib/requirements.ts` is what `doctor` reads, so an extension with no entry
 * is invisible to it, and an entry naming a config file its own `config.ts` never reads is a
 * doctor row for something nothing looks at.
 */

import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { SHARED_CONFIG_FILE } from "../lib/config.ts";
import { REQUIREMENTS } from "../lib/requirements.ts";
import { dirsOf, extensionsDir, filesIn, textOf } from "./helpers/scan.ts";

describe("prerequisite declarations", () => {
	test("every extension declares its runtime prerequisites", () => {
		const undeclared = dirsOf(extensionsDir).filter((name) => REQUIREMENTS[name] === undefined);
		expect(undeclared, "add an entry to REQUIREMENTS in lib/requirements.ts").toEqual([]);
	});

	test("every declared config file is one the extension actually reads", () => {
		const offenders: string[] = [];
		for (const [name, spec] of Object.entries(REQUIREMENTS)) {
			const declared = spec.configFiles ?? [];
			if (declared.length === 0) continue;
			const sources = filesIn(join(extensionsDir, name)).filter((file) => file.endsWith("/config.ts"));
			for (const file of declared) {
				if (sources.length === 0) {
					offenders.push(`${name}: declares ${file} but has no config.ts`);
					continue;
				}
				const literal = sources.some((source) => textOf(source).includes(`"${file}"`));
				// The shared document is read through `loadConfigSection`, so a section
				// loader is the evidence, not the bare filename.
				const shared =
					file === SHARED_CONFIG_FILE && sources.some((source) => textOf(source).includes("loadConfigSection("));
				if (!literal && !shared) offenders.push(`${name}: no config.ts reads ${file}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
