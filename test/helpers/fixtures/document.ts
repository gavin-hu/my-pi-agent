import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A scratch root for `read_doc` tests, with an escape hatch next to it. */
export interface DocumentFixture {
	root: string;
	outside: string;
	/** Write a file under the root (creating parents), returning its absolute path. */
	write(rel: string, contents: string | Uint8Array): string;
	remove(): void;
}

export function makeDocumentFixture(): DocumentFixture {
	const base = mkdtempSync(join(tmpdir(), "pi-doc-"));
	const root = join(base, "root");
	const outside = join(base, "outside");
	mkdirSync(root, { recursive: true });
	mkdirSync(outside, { recursive: true });
	writeFileSync(join(outside, "secret.txt"), "outside\n");

	try {
		symlinkSync(join(outside, "secret.txt"), join(root, "escape.pdf"));
	} catch {
		// Symlinks may be unavailable (e.g. unprivileged Windows); the escape test skips.
	}

	return {
		root: realpathSync.native(root),
		outside: realpathSync.native(outside),
		write(rel, contents) {
			const abs = join(root, rel);
			mkdirSync(dirname(abs), { recursive: true });
			writeFileSync(abs, contents);
			return abs;
		},
		remove: () => rmSync(base, { recursive: true, force: true }),
	};
}
