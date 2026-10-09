import { describe, expect, test } from "bun:test";
import {
	askHuman,
	INTERACTION_TURN_KEY,
	type InteractionMode,
	isRemoteTurn,
	supportsCustomUI,
	type UIContextCarrier,
} from "./interaction.ts";

/** A carrier whose `ctx.ui` reports remote ownership when `remote` is set. */
function carrier(mode: InteractionMode | undefined, remote: boolean): UIContextCarrier {
	const ui: Record<string, unknown> = { select: async () => undefined };
	if (remote) ui[INTERACTION_TURN_KEY] = () => true;
	return { ui, mode };
}

describe("isRemoteTurn", () => {
	test("is false without a marker", () => {
		expect(isRemoteTurn(carrier("tui", false))).toBe(false);
	});

	test("is true when the marker reports an active remote turn", () => {
		expect(isRemoteTurn(carrier("tui", true))).toBe(true);
	});

	test("ignores a non-function marker", () => {
		expect(isRemoteTurn({ ui: { [INTERACTION_TURN_KEY]: true } })).toBe(false);
	});

	test("is false for a missing ui", () => {
		expect(isRemoteTurn({ ui: undefined })).toBe(false);
	});
});

describe("supportsCustomUI", () => {
	test("allows the rich component for a local TUI turn", () => {
		expect(supportsCustomUI(carrier("tui", false))).toBe(true);
	});

	test("denies it for a remote-answered TUI turn", () => {
		expect(supportsCustomUI(carrier("tui", true))).toBe(false);
	});

	test("denies it in rpc and print modes", () => {
		expect(supportsCustomUI(carrier("rpc", false))).toBe(false);
		expect(supportsCustomUI(carrier("print", false))).toBe(false);
	});
});

describe("askHuman", () => {
	const ui = {} as never;

	test("runs custom for a local TUI turn", async () => {
		const result = await askHuman({ ui, mode: "tui" }, { custom: async () => "rich", dialogs: async () => "text" });
		expect(result).toBe("rich");
	});

	test("runs dialogs for a remote-answered TUI turn", async () => {
		const ctx = { ui: ui as Record<string, unknown>, mode: "tui" as InteractionMode };
		ctx.ui[INTERACTION_TURN_KEY] = () => true;
		const result = await askHuman(ctx as never, { custom: async () => "rich", dialogs: async () => "text" });
		expect(result).toBe("text");
	});

	test("runs dialogs in rpc mode", async () => {
		const result = await askHuman({ ui, mode: "rpc" }, { custom: async () => "rich", dialogs: async () => "text" });
		expect(result).toBe("text");
	});
});
