import { describe, expect, test } from "bun:test";
import { analyzeCommand, isSafeCommand, splitSegments } from "../../extensions/plan-mode/safety.ts";

describe("splitSegments", () => {
	test("splits on shell operators", () => {
		expect(splitSegments("ls && git status ; grep x | wc -l")).toEqual(["ls", "git status", "grep x", "wc -l"]);
		expect(splitSegments("a || b")).toEqual(["a", "b"]);
	});

	test("keeps operators inside quotes", () => {
		expect(splitSegments(`grep "a;b" file`)).toEqual([`grep "a;b" file`]);
		expect(splitSegments("grep 'a|b' file")).toEqual(["grep 'a|b' file"]);
	});
});

describe("analyzeCommand — safe", () => {
	const safe = [
		"ls -la",
		"cat package.json",
		"grep -rn TODO src",
		"find . -name '*.ts'",
		"cat a.txt | grep foo",
		"ls && git status",
		"git status",
		"git log --oneline -5",
		"git diff HEAD~1",
		"git branch",
		"git remote -v",
		"git config --get user.email",
		"git worktree list",
		"npm list --depth=0",
		"npm view react version",
		"bun pm ls",
		"node --version",
		"python3 --version",
		"sed -n '1,10p' file",
		"curl https://example.com",
		"printenv PATH",
		"jq '.name' package.json",
		"echo hi > /dev/null",
		"ls 2>&1",
		"wc -l < file",
		"FOO=bar ls",
	];

	for (const command of safe) {
		test(`allows: ${command}`, () => {
			expect(isSafeCommand(command)).toBe(true);
		});
	}
});

describe("analyzeCommand — unsafe", () => {
	const unsafe: Array<[string, string]> = [
		["", "empty"],
		["   ", "empty"],
		["rm -rf build", "rm"],
		["ls; rm -rf build", "second segment"],
		["git commit -m x", "git commit"],
		["git add .", "git add"],
		["git push", "git push"],
		["git branch -D feature", "git branch delete"],
		["git remote add origin url", "git remote add"],
		["git config user.email a@b.c", "git config write"],
		["npm install", "npm install"],
		["node -e 'process.exit()'", "node eval"],
		["python -c 'print(1)'", "python eval"],
		["echo $(whoami)", "command substitution"],
		["echo `whoami`", "backticks"],
		["find . -exec rm {} \\;", "find exec"],
		["find . -delete", "find delete"],
		["sed -i 's/a/b/' f", "sed in-place"],
		["echo hi > out.txt", "redirect"],
		["cat a >> b", "append redirect"],
		["sudo ls", "sudo"],
		["curl -X POST https://x", "curl POST"],
		["curl --data=x https://x", "curl data"],
		["wget --post-data=x y", "wget post"],
		["ls | xargs rm", "xargs"],
		["env rm -rf x", "env wrapper"],
		["awk 'BEGIN { system(\"rm -rf /\") }'", "awk"],
		["chmod 777 x", "chmod"],
		["sort -o out.txt in.txt", "sort output"],
		["date -s 2020-01-01", "date set"],
		["bash -c 'rm -rf x'", "bash"],
	];

	for (const [command, label] of unsafe) {
		test(`rejects (${label}): ${command}`, () => {
			const verdict = analyzeCommand(command);
			expect(verdict.safe).toBe(false);
			expect(verdict.reason).toBeTruthy();
		});
	}

	test("explains why a command was rejected", () => {
		expect(analyzeCommand("rm -rf x").reason).toContain("allowlist");
		expect(analyzeCommand("echo hi > out.txt").reason).toContain("'>'");
	});
});
