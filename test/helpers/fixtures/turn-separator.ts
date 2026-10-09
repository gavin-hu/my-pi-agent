import { fakeCtx as sharedFakeCtx } from "../context.ts";

export interface FakeCtxOptions {
	mode?: string;
	entries?: unknown[];
}

/** Minimal `ExtensionContext` double for the settle handler. */
export function fakeCtx(options: FakeCtxOptions = {}): any {
	return sharedFakeCtx({ mode: options.mode ?? "tui", branch: options.entries }).ctx;
}

/** A separator entry as the store would return it. */
export function separatorEntry(turn: number): unknown {
	return { type: "custom", customType: "turn-separator", data: { turn } };
}
