/**
 * The control screen's key table, against the surfaces it must not drift from.
 *
 * `PANEL_KEYS` answers the screen's input and words its hint row; the verbs it
 * closes with are `/wechat`'s own. Those two links are what a hand-written if-chain
 * and a second hint list kept losing, so they are proved here rather than assumed
 * from the types alone.
 */

import { describe, expect, test } from "bun:test";
import { navIntent } from "../../../lib/tui/cursor.ts";
import { WECHAT_COMMANDS } from "../commands/commands.ts";
import { PANEL_KEYS } from "./status-screen.ts";

describe("the control screen's keys", () => {
	test("no key swallows a navigation key", () => {
		// `j`/`k` and the arrows move the peer cursor; a panel key on top of one
		// would shadow it silently, because the key table is asked first.
		for (const entry of PANEL_KEYS) expect(navIntent(entry.key), entry.key).toBeUndefined();
	});

	test("every closing key names a verb the command registers", () => {
		const verbs = WECHAT_COMMANDS.map((command) => command.verb);
		for (const entry of PANEL_KEYS) {
			if ("close" in entry.effect) expect(verbs, entry.key).toContain(entry.effect.close);
		}
	});

	test("every key is one character, so a press reaches it", () => {
		for (const entry of PANEL_KEYS) expect(entry.key, entry.label).toHaveLength(1);
	});

	test("the key that withdraws a waiting prompt is named in the hint row", () => {
		// `c` was the one peer action a reader had to already know: the verb is
		// `/wechat cancel`, and the hint row is the only place the key is advertised.
		const cancel = PANEL_KEYS.find((entry) => "inPlace" in entry.effect && entry.effect.inPlace === "cancelPrompt");
		expect(cancel?.hint).toBe(true);
	});
});
