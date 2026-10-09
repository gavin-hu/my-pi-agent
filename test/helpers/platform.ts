import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cached: boolean | undefined;

/** Whether this process can create filesystem symlinks (Windows needs Developer Mode/admin). */
export function canCreateSymlinks(): boolean {
	if (cached !== undefined) return cached;
	const base = mkdtempSync(join(tmpdir(), "pi-symlink-probe-"));
	try {
		symlinkSync(base, join(base, "link"), "dir");
		cached = true;
	} catch {
		cached = false;
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
	return cached;
}
