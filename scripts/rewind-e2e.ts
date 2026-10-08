// Real-runtime end-to-end check for /rewind. Loads the extension through the
// real Pi loader, seeds a real session tree, takes a real git snapshot, and
// drives the command through a real command context whose navigateTree is wired
// to AgentSession.navigateTree.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SessionManager, createAgentSession } from "@earendil-works/pi-coding-agent";
import { createSnapshot } from "../extensions/rewind/snapshot.ts";
import type { RunGit } from "../extensions/rewind/git.ts";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rewindEntry = join(repo, "extensions", "rewind", "index.ts");
const agentDir = mkdtempSync(join(tmpdir(), "pi-rewind-e2e-agent-"));

const gitRepo = realpathSync(mkdtempSync(join(tmpdir(), "pi-rewind-e2e-repo-")));
const git = (...args: string[]) => execFileSync("git", args, { cwd: gitRepo, stdio: "pipe" }).toString();
git("init", "-q");
git("config", "user.email", "t@t");
git("config", "user.name", "t");
writeFileSync(join(gitRepo, "a.txt"), "one\n");
git("add", ".");
git("commit", "-qm", "init");

const runGit: RunGit = async (args, options) => {
	try {
		const stdout = execFileSync("git", args, { cwd: options.cwd, encoding: "utf-8" });
		return { stdout, stderr: "", code: 0 };
	} catch (error) {
		const e = error as { stdout?: string; stderr?: string; status?: number };
		return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.status ?? 1 };
	}
};

const loader = new DefaultResourceLoader({ cwd: gitRepo, agentDir, additionalExtensionPaths: [rewindEntry] });
await loader.reload();
const errors = loader.getExtensions().errors;
if (errors.length > 0) {
	console.log("LOAD ERRORS:", errors);
	process.exit(1);
}

const sessionManager = SessionManager.inMemory(gitRepo);
const { session } = await createAgentSession({ resourceLoader: loader, sessionManager });

// Seed a real tree: u1 -> u2 (leaf). Snapshot anchored before the u2 turn.
const u1 = sessionManager.appendMessage({ role: "user", content: "first prompt", timestamp: Date.now() });
const u2 = sessionManager.appendMessage({ role: "user", content: "second prompt", timestamp: Date.now() });
// A real turn ends on a non-user entry, so the newest prompt is not the leaf.
const leafEntry = sessionManager.appendCustomEntry("e2e-leaf", {});
const sessionId = sessionManager.getSessionId();
mkdirSync(join(gitRepo, ".git", "pi"), { recursive: true });

await createSnapshot(
	{ runGit },
	{
		root: gitRepo,
		indexFile: join(gitRepo, ".git", "pi", `e2e-index-${process.pid}`),
		namespace: "refs/pi/rewind",
		reason: "auto",
		prompt: "second prompt",
		includeUntracked: true,
		sessionId,
		entryId: u2,
	},
);
// Dirty the tree after the snapshot, so a code rewind must remove this file.
writeFileSync(join(gitRepo, "after.txt"), "after\n");

let selectCalls = 0;
const uiContext: any = {
	theme: { fg: (_c: string, t: string) => t },
	select: async (title: string, labels: string[]) => {
		selectCalls += 1;
		if (title.startsWith("Rewind to which prompt")) return labels[0];
		return "Code and conversation";
	},
	confirm: async () => true,
	input: async () => undefined,
	notify: (message: string) => console.log("notify:", message),
	setStatus: () => {},
	setWorkingMessage: () => {},
	setWidget: () => {},
	onTerminalInput: () => () => {},
};

await session.bindExtensions({
	uiContext,
	mode: "rpc",
	commandContextActions: {
		waitForIdle: () => session.waitForIdle(),
		newSession: async () => ({ cancelled: false }),
		fork: async () => ({ cancelled: false }),
		navigateTree: async (targetId, options) => {
			const result = await session.navigateTree(targetId, options);
			return { cancelled: result.cancelled };
		},
		switchSession: async () => ({ cancelled: false }),
		reload: async () => {},
	},
});

const command = session.extensionRunner.getCommand("rewind");
if (!command) throw new Error("rewind command not registered");

const leafBefore = sessionManager.getLeafId();

// Isolate the primitive first: the real navigateTree must move the leaf.
const direct = await session.navigateTree(u2);
const directLeaf = sessionManager.getLeafId();
console.log(
	`direct navigateTree: leaf ${leafBefore} -> ${directLeaf}, editorText=${JSON.stringify(direct.editorText)}`,
);
sessionManager.branch(leafEntry);

await command.handler("", session.extensionRunner.createCommandContext());

const leafAfter = sessionManager.getLeafId();
const fileRemoved = !existsSync(join(gitRepo, "after.txt"));

const checks: Array<[string, boolean]> = [
	["command registered", true],
	["real navigateTree moved the leaf to the parent", directLeaf === u1 && direct.editorText === "second prompt"],
	["point picker + scope picker ran", selectCalls >= 2],
	["conversation moved to the parent of the selected prompt", leafAfter === u1],
	["selected prompt's entry is no longer the leaf", leafAfter !== leafBefore],
	["code restored (post-snapshot file removed)", fileRemoved],
];

let ok = true;
for (const [label, pass] of checks) {
	console.log(`${pass ? "ok  " : "FAIL"} ${label}`);
	if (!pass) ok = false;
}
console.log(`leaf: ${leafBefore} -> ${leafAfter} (u1=${u1}, u2=${u2})`);
session.dispose();
console.log(ok ? "E2E OK" : "E2E FAILED");
process.exit(ok ? 0 : 1);
