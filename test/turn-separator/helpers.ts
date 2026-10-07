import { createFakePi, type AnyHandler } from "../helpers/fakes.ts";

export { emit, fakeTheme } from "../helpers/fakes.ts";
export type { AnyHandler };

export interface FakePi {
	pi: any;
	handlers: Map<string, AnyHandler[]>;
	renderers: Map<string, any>;
	appended: Array<{ customType: string; data?: unknown }>;
}

/** Minimal `ExtensionAPI` double covering what the turn-separator extension uses. */
export function makeFakePi(): FakePi {
	const fake = createFakePi();
	return { pi: fake.pi, handlers: fake.handlers, renderers: fake.renderers, appended: fake.appended };
}

export interface FakeCtxOptions {
	mode?: string;
	entries?: unknown[];
}

/** Minimal `ExtensionContext` double for the settle handler. */
export function fakeCtx(options: FakeCtxOptions = {}): any {
	return {
		mode: options.mode ?? "tui",
		sessionManager: {
			getBranch: () => options.entries ?? [],
		},
	};
}

/** A separator entry as the store would return it. */
export function separatorEntry(turn: number): unknown {
	return { type: "custom", customType: "turn-separator", data: { turn } };
}
