// Real-runtime smoke test: load the package through the real Pi loader and
// drive worktree_enter/status/exit without a model call.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { canonicalize } from "../extensions/worktree/git.ts";
import { ROOT_TOOL_NAMES } from "../extensions/worktree/root-tools.ts";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const extensionPath = join(repo, "extensions", "worktree", "index.ts");
const askExtensionPath = join(repo, "extensions", "ask-user-question", "index.ts");
const todoExtensionPath = join(repo, "extensions", "todo", "index.ts");
const planExtensionPath = join(repo, "extensions", "plan-mode", "index.ts");
const agentDir = mkdtempSync(join(tmpdir(), "pi-smoke-agent-"));

// Scratch git repo with one commit.
const work = mkdtempSync(join(tmpdir(), "pi-smoke-repo-"));
const git = (...args: string[]) => execFileSync("git", args, { cwd: work, stdio: "pipe" }).toString();
git("init", "-q");
git("config", "user.email", "t@t");
git("config", "user.name", "t");
writeFileSync(join(work, "a.txt"), "hi\n");
git("add", ".");
git("commit", "-qm", "init");

const loader = new DefaultResourceLoader({
	cwd: work,
	agentDir,
	additionalExtensionPaths: [extensionPath, askExtensionPath, todoExtensionPath, planExtensionPath],
});
await loader.reload();
const loadErrors = loader.getExtensions().errors;
if (loadErrors.length > 0) {
	console.log("LOAD ERRORS:", loadErrors);
	process.exit(1);
}

const { session } = await createAgentSession({
	resourceLoader: loader,
	sessionManager: SessionManager.inMemory(work),
});

const runner = session.extensionRunner;
const tool = (name: string) => {
	const def = runner.getToolDefinition(name);
	if (!def) throw new Error(`missing tool: ${name}`);
	return def;
};
const call = (name: string, params: Record<string, unknown>) =>
	tool(name).execute("smoke", params, undefined, undefined, runner.createToolContext("smoke", undefined));

let ok = true;
const check = (label: string, cond: boolean) => {
	console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
	if (!cond) ok = false;
};

// `findInactiveOverrides` treats a tool as ours when Pi records the extension
// entry file as its source; verify that premise on the real registry.
const entry = canonicalize(extensionPath);
for (const name of ROOT_TOOL_NAMES) {
	const info = session.getAllTools().find((t) => t.name === name);
	check(
		`override ${name} is sourced from the extension entry`,
		!!info?.sourceInfo?.path && canonicalize(info.sourceInfo.path) === entry,
	);
}

const entered = await call("worktree_enter", { name: "smoke" });
const enterText = (entered.content[0] as { text: string }).text;
console.log(enterText.split("\n").slice(0, 4).join("\n"));
const dir = join(work, ".pi", "worktrees", "smoke");
check("worktree directory created", existsSync(dir));
check("enter mentions isolation", /Entered worktree/.test(enterText));

const status = await call("worktree_status", {});
const statusText = (status.content[0] as { text: string }).text;
console.log(statusText);
check("status reports isolated", /Worktree: smoke/.test(statusText));
check("status reports no inactive overrides", !/not active for/.test(statusText));

// ask-user-question loads alongside worktree and gates itself on UI availability.
const askTool = session.getAllTools().find((t) => t.name === "ask_user_question");
check("ask_user_question registered", !!askTool);
check("ask_user_question is model-only", askTool?.exposure === "model-only");
check("ask_user_question inactive without a UI", !session.getActiveToolNames().includes("ask_user_question"));
check("ask_user_question supports no-UI result", !!session.getToolDefinition("ask_user_question"));

// todo loads alongside the others and works headlessly (no widget without a UI).
const todoTool = session.getAllTools().find((t) => t.name === "todo");
check("todo registered", !!todoTool);
check("todo is active by default", session.getActiveToolNames().includes("todo"));
const wrote = await call("todo", { todos: [{ content: "smoke task", status: "in_progress" }] });
const wroteText = (wrote.content[0] as { text: string }).text;
const wroteDetails = wrote.details as { todos: unknown[]; action: string };
check("todo writes a checklist", /1\. \[~\] smoke task/.test(wroteText));
check("todo keeps structured details", wroteDetails.todos.length === 1 && wroteDetails.action === "write");
const cleared = await call("todo", { todos: [] });
const clearedDetails = cleared.details as { todos: unknown[]; action: string };
check("todo clears", clearedDetails.todos.length === 0 && clearedDetails.action === "clear");

// plan-mode loads; the read-only entry tool is active, the exit tool is not, and
// a headless entry attempt refuses instead of entering silently.
check("enter_plan_mode registered", !!session.getAllTools().find((t) => t.name === "enter_plan_mode"));
check("exit_plan_mode registered", !!session.getAllTools().find((t) => t.name === "exit_plan_mode"));
check("enter_plan_mode active by default", session.getActiveToolNames().includes("enter_plan_mode"));
check("exit_plan_mode inactive without plan mode", !session.getActiveToolNames().includes("exit_plan_mode"));
const enterResult = await call("enter_plan_mode", {});
check(
	"enter_plan_mode refuses without a UI",
	enterResult.isError === true && /No interactive UI/.test((enterResult.content[0] as { text: string }).text),
);

const exited = await call("worktree_exit", { remove: true });
const exitText = (exited.content[0] as { text: string }).text;
console.log(exitText);
check("worktree directory removed", !existsSync(dir));
check("branch deleted", !git("branch").includes("worktree-smoke"));

session.dispose();
console.log(ok ? "SMOKE OK" : "SMOKE FAILED");
process.exit(ok ? 0 : 1);
