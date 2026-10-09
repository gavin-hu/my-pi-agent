import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A scratch root for `read_doc` tests, with an escape hatch next to it. */
export interface DocFixture {
	root: string;
	outside: string;
	/** False when the host refused to create symlinks (e.g. unprivileged Windows). */
	hasSymlinks: boolean;
	/** Write a file under the root (creating parents), returning its absolute path. */
	write(rel: string, contents: string | Uint8Array): string;
	remove(): void;
}

export function makeDocFixture(): DocFixture {
	const base = mkdtempSync(join(tmpdir(), "pi-doc-"));
	const root = join(base, "root");
	const outside = join(base, "outside");
	mkdirSync(root, { recursive: true });
	mkdirSync(outside, { recursive: true });
	writeFileSync(join(outside, "secret.txt"), "outside\n");

	let hasSymlinks = true;
	try {
		symlinkSync(join(outside, "secret.txt"), join(root, "escape.pdf"));
	} catch {
		// Symlinks may be unavailable (e.g. unprivileged Windows); tests skip.
		hasSymlinks = false;
	}

	return {
		root: realpathSync.native(root),
		outside: realpathSync.native(outside),
		hasSymlinks,
		write(rel, contents) {
			const abs = join(root, rel);
			mkdirSync(dirname(abs), { recursive: true });
			writeFileSync(abs, contents);
			return abs;
		},
		remove: () => rmSync(base, { recursive: true, force: true }),
	};
}
