/**
 * `/team`'s argument completion, as the editor applies it.
 *
 * The completer answers a list of suggestions and pi-tui decides what Tab does with one: the value
 * replaces the *argument text*, not the last token. So the cases here go through the host's own
 * provider rather than reading the completer's return value — a suite that asserted the list agreed
 * with the completer while the editor deleted the word it was typed after (#920).
 *
 * The two facts this file holds that `commands.test.ts` does not: a label completes into the line
 * the handler parses, and a completer may never throw at the editor — it awaits with no catch, so a
 * rejection costs every later Tab in the process its autocomplete (#921).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import { openBoardSession } from "../../lib/workflow/session.ts";
import { TEAM_COMMAND } from "./commands.ts";
import { registerCommands } from "./commands.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi, emit } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { teamCommandHarness } from "../../test/helpers/team.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 1_760_000_000_000;

/** The command on a board of this suite's, mounted once per case. */
const mount = teamCommandHarness(NOW, temps.track);

/**
 * One Tab in the editor: the first suggestion replaces the argument text.
 *
 * The provider is the host's, because the fact under test is what pi-tui does with the value. A copy
 * of `applyCompletion` here would agree with the completer and disagree with the editor.
 */
async function tabbed(mounted: ReturnType<typeof mount>, line: string): Promise<string | null> {
	const complete = mounted.command.getArgumentCompletions;
	if (complete === undefined) throw new Error("the team command registered no completer");
	const provider = new CombinedAutocompleteProvider(
		[{ name: TEAM_COMMAND, getArgumentCompletions: complete }],
		mounted.ctx.cwd,
	);
	const suggestions = await provider.getSuggestions([line], 0, line.length, {
		signal: new AbortController().signal,
	});
	const [item] = suggestions?.items ?? [];
	if (suggestions === null || item === undefined) return null;
	return provider.applyCompletion([line], 0, line.length, item, suggestions.prefix).lines[0] ?? null;
}

/** A mounted command with its root read, which is what a label completion needs. */
async function joined(options: Parameters<typeof mount>[0] = {}): Promise<ReturnType<typeof mount>> {
	const mounted = mount(options);
	await emit(mounted.fake.pi, "session_start", {}, mounted.ctx);
	return mounted;
}

describe("the value Tab applies", () => {
	test("keeps the word that asked for the list", async () => {
		const mounted = await joined({ teammates: ["billing-core", "ops-core"] });
		// The whole argument, not the name: a bare label would leave `/team billing-core`, which the
		// handler refuses as a word it does not know.
		expect(await tabbed(mounted, "/team who ")).toBe("/team who billing-core");
		expect(await tabbed(mounted, "/team join o")).toBe("/team join ops-core");
	});

	test("completes the words themselves, and stops after one that takes no argument", async () => {
		const mounted = await joined({ teammates: ["billing-core"] });
		expect(await tabbed(mounted, "/team wh")).toBe("/team who ");
		// A word with no argument ends the list rather than offering names after it.
		expect(await tabbed(mounted, "/team help ")).toBeNull();
	});

	test("writes the word the command parses, however it was typed", async () => {
		const mounted = await joined({ teammates: ["billing-core"] });
		// The handler parses the lowercase word, and the value replaces what was typed: a completion
		// that echoed the typed spelling would complete into a line the command refuses.
		expect(await tabbed(mounted, "/team W")).toBe("/team who ");
		expect(await tabbed(mounted, "/team JOIN b")).toBe("/team join billing-core");
	});

	test("completes a team name stated with a space in it", async () => {
		// The handler joins its argument, so the label is the whole rest: ending the list at the second
		// word left such a name completable only by typing it out in full.
		const mounted = await joined({ teammates: ["billing core", "ops-core"] });
		expect(await tabbed(mounted, "/team who billing c")).toBe("/team who billing core");
	});
});

describe("what a completer may hand the editor", () => {
	test("answers nothing when the store cannot open, rather than throwing at the editor", async () => {
		// The editor awaits this with no catch, so a rejection here is the whole process's
		// autocomplete; a store that cannot open is a repository this command cannot name.
		const fake = createFakePi();
		const unreachable = openBoardSession(fake.pi, {
			open: async () => {
				throw new Error("git is not on PATH");
			},
		});
		registerCommands(fake.pi, unreachable);
		const command = fake.commands.get(TEAM_COMMAND);
		if (!command) throw new Error("the team command was not registered");
		const { ctx } = fakeCtx({ cwd: "/repo" });
		await emit(fake.pi, "session_start", {}, ctx);
		// `resolves` rather than a null read off a settled call: without the guard this promise
		// rejects, so the case fails on the rejection the editor would have met, not on a shape.
		await expect(command.getArgumentCompletions?.("who ")).resolves.toBeNull();
		// The words are static and read no store: the keystroke after a failed one still completes.
		expect(await command.getArgumentCompletions?.("w")).toEqual([{ value: "who ", label: "who" }]);
	});
});
