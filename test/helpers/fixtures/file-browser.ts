import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FakePi } from "../fakes.ts";
import { createFakePi } from "../fakes.ts";
import { fakeCtx as sharedFakeCtx } from "../context.ts";

export type { FakePi };
export { createFakePi };

/** A scratch tree with text, image, binary, nested, hidden, and symlink files. */
export interface Fixture {
	root: string;
	outside: string;
	/** False when the host refused to create symlinks (e.g. unprivileged Windows). */
	hasSymlinks: boolean;
	remove(): void;
}

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");

export function makeFixture(): Fixture {
	const base = mkdtempSync(join(tmpdir(), "pi-serve-"));
	const root = join(base, "root");
	const outside = join(base, "outside");
	mkdirSync(join(root, "sub"), { recursive: true });
	mkdirSync(outside, { recursive: true });
	writeFileSync(join(root, "a.txt"), "hello\nworld\n");
	writeFileSync(join(root, "sub", "b.md"), "# hi\n");
	writeFileSync(join(root, "image.png"), PNG);
	writeFileSync(join(root, ".hidden"), "secret\n");
	writeFileSync(join(root, "bin.dat"), Buffer.from([0, 1, 2, 3, 0, 4]));
	writeFileSync(join(root, "big.txt"), Array.from({ length: 10 }, (_, index) => `line ${index}`).join("\n"));
	writeFileSync(join(outside, "secret.txt"), "outside\n");
	let hasSymlinks = true;
	try {
		symlinkSync(join(root, "a.txt"), join(root, "link.txt"));
		symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));
	} catch {
		// Symlinks may be unavailable (e.g. unprivileged Windows); tests skip.
		hasSymlinks = false;
	}
	// realpath so tests compare against the same form the server resolves.
	return {
		root: realpathSync.native(root),
		outside: realpathSync.native(outside),
		hasSymlinks,
		remove: () => rmSync(base, { recursive: true, force: true }),
	};
}

export interface FakeCtx {
	ctx: any;
	notifications: Array<{ message: string; level: string }>;
	statuses: Map<string, string>;
}

export interface FakeCtxOptions {
	/** Theme double; defaults to identity `fg` so rendered text stays assertable. */
	theme?: { fg(color: string, text: string): string };
}

/** A minimal `ExtensionContext` double; no UI, so `ui.notify` just records. */
export function fakeCtx(cwd: string, mode = "print", options: FakeCtxOptions = {}): FakeCtx {
	const result = sharedFakeCtx({ cwd, mode, hasUI: false, theme: options.theme });
	const notifications: Array<{ message: string; level: string }> = [];
	result.ctx.ui.notify = (message: string, level = "info") => {
		notifications.push({ message, level });
	};
	return { ctx: result.ctx, notifications, statuses: result.statuses as Map<string, string> };
}

/** Run a command handler registered on a fake pi. */
export async function runCommand(pi: FakePi, name: string, args: string, ctx: any): Promise<void> {
	const command = pi.commands.get(name);
	if (!command) throw new Error(`missing command: ${name}`);
	await command.handler(args, ctx);
}

/** Epoch ms for a local date/time, for deterministic `formatDate` tests. */
export function localTimeMs(year: number, month: number, day: number, hour: number, minute: number): number {
	return new Date(year, month, day, hour, minute).getTime();
}
