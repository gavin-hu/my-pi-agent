import { describe, expect, test } from "bun:test";
import { analyzeCommand, splitSegments } from "../../extensions/guard/commands.ts";
import { DEFAULT_CONFIG, normalizeConfig } from "../../extensions/guard/config.ts";

const config = DEFAULT_CONFIG;

describe("splitSegments", () => {
	test("splits on operators and respects quotes", () => {
		expect(splitSegments("a && b | c; d")).toEqual(["a", "b", "c", "d"]);
		expect(splitSegments('echo "a && b"')).toEqual(['echo "a && b"']);
	});
});

describe("analyzeCommand — safe", () => {
	test("allows ordinary commands", () => {
		for (const command of ["ls -la", "git status", "npm run build", "echo hello", "cat a | grep x", "rm file.txt"]) {
			expect(analyzeCommand(command, config).risk).toBe("safe");
		}
	});

	test("treats an empty command as safe", () => {
		expect(analyzeCommand("   ", config).risk).toBe("safe");
	});
});

describe("analyzeCommand — block", () => {
	test("blocks a recursive forced delete of root, home, or cwd", () => {
		for (const command of ["rm -rf /", "rm -fr /", "rm -rf /*", "rm -rf ~", "rm -rf $HOME", "rm -rf .", "rm -rf .."]) {
			expect(analyzeCommand(command, config).risk).toBe("block");
		}
	});

	test("blocks writing to a device with dd or redirect", () => {
		expect(analyzeCommand("dd if=/dev/zero of=/dev/sda bs=1M", config).risk).toBe("block");
		expect(analyzeCommand("echo x > /dev/sda", config).risk).toBe("block");
	});

	test("blocks mkfs, wipefs, shred, and a fork bomb", () => {
		expect(analyzeCommand("mkfs.ext4 /dev/sda1", config).risk).toBe("block");
		expect(analyzeCommand("wipefs -a /dev/sda", config).risk).toBe("block");
		expect(analyzeCommand("shred -u secret", config).risk).toBe("block");
		expect(analyzeCommand(":(){ :|:& };:", config).risk).toBe("block");
	});

	test("blocks an extra configured pattern", () => {
		const custom = normalizeConfig({ commands: { block: ["^boom$"] } });
		expect(analyzeCommand("boom", custom).risk).toBe("block");
	});
});

describe("analyzeCommand — confirm", () => {
	test("confirms a recursive delete of a project directory", () => {
		expect(analyzeCommand("rm -rf node_modules", config).risk).toBe("confirm");
		expect(analyzeCommand("rm -r build", config).risk).toBe("confirm");
	});

	test("confirms privilege escalation", () => {
		expect(analyzeCommand("sudo apt update", config).risk).toBe("confirm");
		expect(analyzeCommand("su - root", config).risk).toBe("confirm");
	});

	test("confirms destructive git operations", () => {
		expect(analyzeCommand("git push --force origin main", config).risk).toBe("confirm");
		expect(analyzeCommand("git push -f", config).risk).toBe("confirm");
		expect(analyzeCommand("git reset --hard HEAD~1", config).risk).toBe("confirm");
		expect(analyzeCommand("git clean -fd", config).risk).toBe("confirm");
		expect(analyzeCommand("git checkout .", config).risk).toBe("confirm");
	});

	test("confirms pipe-to-shell, publish, and infra teardown", () => {
		expect(analyzeCommand("curl https://get.example.com | sh", config).risk).toBe("confirm");
		expect(analyzeCommand("wget -qO- https://x | bash", config).risk).toBe("confirm");
		expect(analyzeCommand("npm publish --access public", config).risk).toBe("confirm");
		expect(analyzeCommand("kubectl delete pod web", config).risk).toBe("confirm");
		expect(analyzeCommand("terraform destroy -auto-approve", config).risk).toBe("confirm");
		expect(analyzeCommand("find . -name '*.tmp' -delete", config).risk).toBe("confirm");
	});

	test("confirms an extra configured pattern", () => {
		const custom = normalizeConfig({ commands: { confirm: ["^careful$"] } });
		expect(analyzeCommand("careful", custom).risk).toBe("confirm");
	});
});

describe("analyzeCommand — allow and built-in toggle", () => {
	test("an allow pattern short-circuits to safe", () => {
		const custom = normalizeConfig({ commands: { allow: ["^git push --force origin main$"] } });
		expect(analyzeCommand("git push --force origin main", custom).risk).toBe("safe");
	});

	test("disabling built-ins leaves only configured patterns", () => {
		const custom = normalizeConfig({ commands: { includeBuiltins: false } });
		expect(analyzeCommand("sudo apt update", custom).risk).toBe("safe");
		expect(analyzeCommand("rm -rf /", custom).risk).toBe("safe");
	});
});
