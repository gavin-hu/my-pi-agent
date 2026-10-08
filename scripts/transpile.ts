import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Transpile every extension entrypoint to standalone Node ESM, with all imports
// left external. This catches syntax/import-shape errors that `tsc --noEmit`
// can miss. Output goes to a fresh temp directory (never hardcode /tmp, which
// Windows rejects) and is removed afterwards; discovery is by convention so
// adding a new `extensions/<name>/index.ts` needs no script edit.

const repo = join(import.meta.dir, "..");
const extensionsDir = join(repo, "extensions");

const names = readdirSync(extensionsDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && existsSync(join(extensionsDir, entry.name, "index.ts")))
	.map((entry) => entry.name)
	.sort();

if (names.length === 0) {
	console.error("transpile: no extension entrypoints found under extensions/*/index.ts");
	process.exit(1);
}

const outDir = mkdtempSync(join(tmpdir(), "pi-transpile-"));

try {
	for (const name of names) {
		const entry = join(extensionsDir, name, "index.ts");
		const outfile = join(outDir, `pi-${name}-index.js`);
		const result = spawnSync(
			process.execPath,
			["build", entry, "--no-bundle", "--external", "*", "--target=node", `--outfile=${outfile}`],
			{ stdio: "inherit" },
		);

		if (result.error) {
			console.error(`transpile: failed to run bun build for ${name}: ${result.error.message}`);
			process.exit(1);
		}
		if (result.status !== 0) {
			console.error(`transpile: ${name} failed to transpile`);
			process.exit(1);
		}
	}
} finally {
	rmSync(outDir, { recursive: true, force: true });
}

console.log(`Transpiled ${names.length} extensions: ${names.join(", ")}`);
