/**
 * The landing verb: the argv it writes, the proof it refuses on, and the undo it leaves behind.
 *
 * The seam is a fake `RunGit`, so every case is a script of git's answers rather than a
 * repository: what is pinned here is the order the commands run in, the exact argv of the two that
 * can destroy work (`reset --keep`, never `--hard`; `push <remote> <branch>:<branch>`, never bare),
 * and that a failure after the merge says the merge was undone.
 */

import { describe, expect, test } from "bun:test";
import { signBus, type Sent } from "../../test/helpers/board-signs.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { boardCard } from "../../test/helpers/fixtures/board.ts";
import {
	Answer,
	BASE,
	BRANCH,
	CARD,
	cleanLanding,
	fakeGit,
	landingWith,
	MERGE,
	REVIEWED,
} from "../../test/helpers/land-git.ts";
import { landCardDoor } from "./land-action.ts";
import type { Card } from "../../lib/workflow/card.ts";
import { type LandRow, landScope, landSubject, parseNumstat } from "../../lib/workflow/land.ts";

describe("landSubject", () => {
	test("derives the scope from the extension the paths share, and strips a title's own prefix", () => {
		expect(landSubject(CARD)).toBe("merge(board): land is a reviewed card's verb, not a mode exit (#856)");
	});

	test("strips a typed scope and a bare one, and leaves an unprefixed title alone", () => {
		// A title that opens `type(scope):` is the shape this board writes, and the one the first
		// pattern missed: the subject would have named the surface twice, permanently.
		const typed = boardCard("857", {
			title: "docs(board): the seat's allow-list and its two phases, held to the constant",
		});
		// The prefix is the scope as well as the thing to strip: a card with no extension in its
		// paths is named by its title, and `docs(board)` is the scope the commit format gives it.
		expect(landSubject(typed)).toBe(
			"merge(docs(board)): the seat's allow-list and its two phases, held to the constant (#857)",
		);
		const bare = boardCard("1", { title: "docs: the seat's allow-list" });
		expect(landSubject(bare)).toBe("merge(docs): the seat's allow-list (#1)");
		const plain = boardCard("2", { title: "the seat's allow-list" });
		expect(landSubject(plain)).toBe("merge(board): the seat's allow-list (#2)");
	});

	test("names the one extension its paths are in, bare or nested", () => {
		expect(landScope(boardCard("1", { paths: ["extensions/plan/a.ts", "lib/workflow/b.ts"] }))).toBe("plan");
		// A directory hint names its extension as clearly as a file does: #866's paths were two
		// directories, and the first pattern needed a trailing slash to see either.
		expect(landScope(boardCard("2", { paths: ["extensions/session-bus"] }))).toBe("session-bus");
		// A path is data: the same card typed on Windows earns the same scope.
		expect(landScope(boardCard("3", { paths: ["extensions\\session-bus\\runtime.ts"] }))).toBe("session-bus");
	});

	test("keeps the extension only while it is where the card's work is", () => {
		// #853's card holds: its own page, a guide, and the changelog are part of the work, and a tie
		// stays with the extension.
		expect(
			landScope(
				boardCard("1", {
					paths: ["extensions/plan/a.ts", "docs/extensions/plan.md", "docs/multi-session.md", "CHANGELOG.md"],
				}),
			),
		).toBe("plan");
		expect(landScope(boardCard("2", { paths: ["extensions/plan/a.ts", "test/suite-manifest.ts"] }))).toBe("plan");
		// #931's shape: one corrected docstring in another extension's suite, outnumbered by three
		// paths that name another surface, so the area rung answers. `merge(wechat)` went into the
		// history of a card that changed no wechat behaviour, and a landed sha cannot be repaired.
		expect(
			landScope(
				boardCard("3", {
					paths: [
						"docs/design-system.md",
						"docs/_data/docs.json",
						"docs/extensions/bytefly.md",
						"lib/tui",
						"lib/README.md",
						"package.json",
						"README.md",
						"README.zh-CN.md",
						"test/site-docs.test.ts",
						"test/tui-conventions.test.ts",
						"extensions/wechat/boundary.test.ts",
						"CHANGELOG.md",
					],
				}),
			),
		).toBe("docs");
		// A test sweep is test work, even when one of its suites sits beside an extension.
		expect(landScope(boardCard("4", { paths: ["extensions/x/a.test.ts", "test/a.test.ts", "test/b.test.ts"] }))).toBe(
			"test",
		);
		// The rule is the extension's OWN code: a helper in `lib/` is not it, so a suite beside an
		// extension with one root ledger and one shared helper is still a test sweep.
		expect(landScope(boardCard("6", { paths: ["extensions/x/a.test.ts", "test/a.test.ts", "lib/y.ts"] }))).toBe("test");
		// #992's shape: the extension's record, two shared helpers, and two ledgers that ride the
		// change. The ledgers are not the work, so they cannot outvote the extension.
		const recorded = ["extensions/session-bus", "lib/session-files.ts", "lib/session-mail.ts"];
		expect(
			landScope(
				boardCard("5", { paths: [...recorded, "test/suite-manifest.ts", "test/dependencies.test.ts", "CHANGELOG.md"] }),
			),
		).toBe("session-bus");
	});

	test("names `docs` for a card whose subject is a documented root file", () => {
		// #932's landing, verbatim: the changelog rides every card and the manifest rides the code, so
		// the one test file that measured the change was the only path with a directory to name, and a
		// `CONTRIBUTING.md` card landed `merge(test)`.
		expect(landScope(boardCard("1", { paths: ["CONTRIBUTING.md", "test/drift.test.ts", "CHANGELOG.md"] }))).toBe(
			"docs",
		);
		expect(landScope(boardCard("2", { paths: ["AGENTS.md", "test/drift.test.ts"] }))).toBe("docs");
		// The manifest answers nothing, so a rider cannot outvote the code it accompanies.
		expect(landScope(boardCard("3", { paths: ["package.json", "lib/workflow/land.ts"] }))).toBe("lib");
		expect(landScope(boardCard("4", { paths: ["CONTRIBUTING.md", "package.json"] }))).toBe("docs");
	});

	test("falls to the title when no extension is named, so a lib card is not the landing door's", () => {
		// #868's shape, which landed `merge(board)` under a `session-bus:` title.
		expect(
			landScope(
				boardCard("1", { title: "session-bus: a roster read of its own record", paths: ["lib/workflow/join.ts"] }),
			),
		).toBe("session-bus");
		// Disagreeing extensions are no single scope, and the title is the one fact left that can
		// name it — the line a later editor is likeliest to flip.
		expect(
			landScope(
				boardCard("2", {
					title: "session-bus: two doors",
					paths: ["extensions/plan/a.ts", "extensions/board/b.ts"],
				}),
			),
		).toBe("session-bus");
	});

	test("falls to the first path's area, and to board only when the card names nothing", () => {
		// No extension and no prefix: the area is the scope the commit format gives it, and
		// `extensions` is a container rather than an area, so two disagreeing extensions still
		// fall through to board instead of `merge(extensions)`.
		expect(landScope(boardCard("1", { paths: ["lib/workflow/b.ts", "CHANGELOG.md"] }))).toBe("lib");
		expect(landScope(boardCard("2", { paths: ["extensions/plan/a.ts", "extensions/board/b.ts"] }))).toBe("board");
		expect(landScope(boardCard("3", { paths: [] }))).toBe("board");
	});
});

describe("landCard — the order and the argv", () => {
	test("lands a reviewed card: fetch, equality, ancestry, merge, proof, named-ref push", async () => {
		const { git, answer } = landingWith(cleanLanding());
		const result = await answer;
		if ("error" in result) throw new Error(result.error);
		expect(result.merge).toBe(MERGE);
		expect(result.pushed).toBe("origin main");
		expect(result.rows).toEqual([
			{ path: "CHANGELOG.md", added: 5, deleted: 0 },
			{ path: "extensions/board/lead-gate.test.ts", added: 59, deleted: 0 },
		]);
		expect(git.calls.map((args) => args[0])).toEqual([
			"fetch",
			"rev-parse",
			"status",
			"rev-parse",
			"rev-parse",
			"rev-parse",
			"merge",
			"rev-parse",
			"merge-base",
			"diff",
			"push",
		]);
		// The merge is the card's subject, the branch the review named, and nothing else.
		expect(git.argv("merge").at(0)).toEqual([
			"merge",
			"--no-ff",
			"-m",
			"merge(board): land is a reviewed card's verb, not a mode exit (#856)",
			REVIEWED,
		]);
		// A named ref, and never a force.
		expect(git.calls.at(-1)).toEqual(["push", "origin", "main:main"]);
	});
});

describe("landCard — every refusal, and what it leaves behind", () => {
	test("refuses a fetch it could not make, before anything is read", async () => {
		const { git, answer } = landingWith(
			cleanLanding({ fetch: { code: 128, stderr: "Permission denied (publickey)" } }),
		);
		expect(await answer).toEqual({
			error: "could not fetch origin (Permission denied (publickey)) — `/board stop` and land by hand.",
		});
		expect(git.calls.map((args) => args[0])).toEqual(["fetch"]);
	});

	test("refuses a checkout that is not on the branch", async () => {
		const { answer } = landingWith(cleanLanding({ "rev-parse --abbrev-ref": { stdout: "worktree-one\n" } }));
		expect(await answer).toMatchObject({
			error: expect.stringContaining("this checkout is on `worktree-one`, not `main`"),
		});
	});

	test("refuses a dirty tree", async () => {
		const { answer } = landingWith(cleanLanding({ status: { stdout: " M lib/workflow/lead.ts\n" } }));
		expect(await answer).toMatchObject({ error: expect.stringContaining("uncommitted changes") });
	});

	test("refuses when main is not the remote's tip", async () => {
		const { answer } = landingWith(cleanLanding({ "rev-parse origin/main": { stdout: `${REVIEWED}\n` } }));
		expect(await answer).toMatchObject({ error: expect.stringContaining("reconcile it first") });
	});

	test("refuses a branch that moved past the sign, before any merge", async () => {
		const { git, answer } = landingWith(cleanLanding({ "rev-parse worktree-one": { stdout: `${BRANCH}\n` } }));
		expect(await answer).toMatchObject({
			error: expect.stringContaining("the branch moved past the sign — review it again"),
		});
		// The signed tree is the branch, not merely an ancestor of it: nothing is merged.
		expect(git.argv("merge")).toEqual([]);
	});

	test("aborts a conflicting merge and says the branch is untouched", async () => {
		const { git, answer } = landingWith(
			cleanLanding({ merge: { code: 1, stdout: "CONFLICT (content): CHANGELOG.md" } }),
		);
		expect(await answer).toMatchObject({ error: expect.stringContaining("the branch is untouched") });
		expect(git.calls).toContainEqual(["merge", "--abort"]);
		expect(git.argv("reset")).toEqual([]);
	});

	test("undoes a merge whose sha it cannot read, and never with --hard", async () => {
		const { git, answer } = landingWith(
			cleanLanding({ "rev-parse HEAD": [{ stdout: `${BASE}\n` }, { code: 128, stderr: "bad revision" }] }),
		);
		expect(await answer).toMatchObject({ error: expect.stringContaining("the merge was undone") });
		expect(git.argv("reset").at(0)).toEqual(["reset", "--keep", BASE]);
		expect(git.calls.some((args) => args.includes("--hard"))).toBe(false);
	});

	test("undoes a merge that does not carry the signed tree", async () => {
		const { git, answer } = landingWith(cleanLanding({ "merge-base --is-ancestor": { code: 1 } }));
		expect(await answer).toMatchObject({ error: expect.stringContaining("does not carry the signed tree") });
		expect(git.argv("reset").at(0)).toEqual(["reset", "--keep", BASE]);
	});

	test("undoes the merge when the push is refused, and says the remote moved", async () => {
		const { git, answer } = landingWith(
			cleanLanding({ push: { code: 1, stderr: "! [rejected] main -> main (fetch first)" } }),
		);
		expect(await answer).toMatchObject({ error: expect.stringContaining("the remote moved") });
		expect(git.argv("reset").at(0)).toEqual(["reset", "--keep", BASE]);
	});
});

describe("parseNumstat", () => {
	test("reads a binary file's dashes as zero rather than a count", () => {
		const rows: LandRow[] = parseNumstat("-\t-\tassets/logo.png\n3\t1\tlib/a.ts\n");
		expect(rows).toEqual([
			{ path: "assets/logo.png", added: 0, deleted: 0 },
			{ path: "lib/a.ts", added: 3, deleted: 1 },
		]);
	});
});

describe("landCardDoor — the seat's questions, before any git", () => {
	const EXECUTED: Card = boardCard("856", {
		lane: "execute",
		title: "board: land is a reviewed card's verb, not a mode exit",
		paths: ["extensions/board/actions.ts"],
		owner: { label: "jack" },
		review: {
			by: "gavin",
			at: 10,
			verified: { cmd: "true", exit: 0, at: 10, root: "/tree", branch: "worktree-one", sha: REVIEWED },
		},
	} as Partial<Card>);

	/** A board the door can read: one card, and the lead's name. */
	function board(card: Card | undefined) {
		return { store: async () => ({ read: async () => card, config: () => ({ lead: "gavin" }) }) };
	}

	/** `pi.exec` as the door's seam, answering from the same script the unit cases use. */
	function host(script: Record<string, Answer | Answer[]>, bus: { fail?: string; delivered?: string } = {}) {
		const git = fakeGit(script);
		const sent: Sent[] = [];
		return {
			git,
			sent,
			// `createFakePi` hands back the double and its recorders; the host is the `.pi` half.
			pi: createFakePi({
				exec: async (_command: string, args: string[], options?: { cwd?: string }) => {
					const result = await git.run(args, { cwd: options?.cwd ?? "/checkout" });
					return { stdout: result.stdout, stderr: result.stderr, code: result.code };
				},
			}).pi,
			notify: signBus({ sent, delivered: "jack", ...bus }),
		};
	}

	test("refuses a session that is not the seat, naming the door that is open", async () => {
		const { pi, notify } = host(cleanLanding());
		const answer = await landCardDoor({
			pi,
			notify,
			runtime: board(EXECUTED),
			ctx: { cwd: "/checkout" },
			me: { id: "s-tom", label: "tom" },
			card: "856",
		});
		expect(answer).toMatchObject({ kind: "refused", error: expect.stringContaining("`/board` takes the seat") });
	});

	test("refuses a card that is not in execute, and hands the card back", async () => {
		const card = boardCard("1");
		const { pi, notify } = host(cleanLanding());
		const answer = await landCardDoor({
			pi,
			notify,
			runtime: board(card),
			ctx: { cwd: "/checkout" },
			me: { label: "gavin", seat: true },
			card: "1",
		});
		expect(answer).toMatchObject({ kind: "refused", error: expect.stringContaining("runs in `execute`"), card });
	});

	test("refuses a card whose spot-check records no tree", async () => {
		const { pi, notify } = host(cleanLanding());
		const answer = await landCardDoor({
			pi,
			notify,
			runtime: board(boardCard("1", { lane: "execute" })),
			ctx: { cwd: "/checkout" },
			me: { label: "gavin", seat: true },
			card: "1",
		});
		expect(answer).toMatchObject({ kind: "refused", error: expect.stringContaining("has no spot-check") });
	});

	test("lands through the door: the line names the merge, the proof and the push", async () => {
		const { pi, git, notify } = host(cleanLanding());
		const answer = await landCardDoor({
			pi,
			notify,
			runtime: board(EXECUTED),
			ctx: { cwd: "/checkout" },
			me: { label: "gavin", seat: true },
			card: "856",
		});
		expect(answer).toMatchObject({
			kind: "landed",
			text: "Landed: merge 44444444 — merge(board): land is a reviewed card's verb, not a mode exit (#856)\nproof: CHANGELOG.md 5/0 · extensions/board/lead-gate.test.ts 59/0 · pushed origin main\n  told jack",
		});
		expect(git.calls.at(-1)).toEqual(["push", "origin", "main:main"]);
	});

	test("tells the holder the merge is theirs to close, once, as the event the close hangs off", async () => {
		// The last step of the loop had no message: the seat merged and the holder found out by
		// polling `origin/main`. The sha is in the sentence because `done` resolves against it.
		const { pi, notify, sent } = host(cleanLanding());
		await landCardDoor({
			pi,
			notify,
			runtime: board(EXECUTED),
			ctx: { cwd: "/checkout" },
			me: { label: "gavin", seat: true },
			card: "856",
		});
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ kind: "event", to: "jack", about: "856" });
		expect(sent[0]?.text).toContain("merge 44444444 on main");
		expect(sent[0]?.text).toContain('lane "done"');
	});

	test("a refused send costs a clause, and the landing stands", async () => {
		// The merge is pushed before the message is composed, so a bus that refuses can never undo
		// it: the seat reads who was not told, and the card is landed all the same.
		const { pi, git, notify } = host(cleanLanding(), { fail: "the session bus is not loaded" });
		const answer = await landCardDoor({
			pi,
			notify,
			runtime: board(EXECUTED),
			ctx: { cwd: "/checkout" },
			me: { label: "gavin", seat: true },
			card: "856",
		});
		expect(answer.kind).toBe("landed");
		expect(answer.kind === "landed" ? answer.text : "").toContain("jack was not told (the session bus is not loaded)");
		expect(git.calls.at(-1)).toEqual(["push", "origin", "main:main"]);
	});
});
