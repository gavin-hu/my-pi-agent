import { afterAll, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import { DETECTORS, detectCommands, packageManager, planCommands } from "./detect.ts";

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A temp project. */
function project(prefix: string): string {
	const dir = tempDir(prefix);
	dirs.push(dir);
	return dir;
}

/** One project file. */
function file(dir: string, name: string, content = ""): void {
	writeFileSync(join(dir, name), content);
}

describe("detectCommands", () => {
	test("reads package.json scripts and the lockfile's package manager", () => {
		const dir = project("pi-check-node-");
		file(dir, "bun.lock");
		file(
			dir,
			"package.json",
			JSON.stringify({
				scripts: { test: "bun test", lint: "biome check", typecheck: "tsc", check: "bun run check" },
			}),
		);

		const commands = detectCommands(dir);
		expect(commands?.test).toEqual({ command: "bun run test", label: "bun run test" });
		expect(commands?.lint).toEqual({ command: "bun run lint", label: "bun run lint" });
		expect(commands?.typecheck).toEqual({ command: "bun run typecheck", label: "bun run typecheck" });
		expect(commands?.all).toEqual({ command: "bun run check", label: "bun run check" });
		expect(packageManager(dir)).toBe("bun");
	});

	test("defaults to npm without a recognized lockfile", () => {
		const dir = project("pi-check-npm-");
		file(dir, "package.json", JSON.stringify({ scripts: { test: "node --test" } }));

		expect(detectCommands(dir)?.test?.command).toBe("npm run test");
		expect(packageManager(dir)).toBe("npm");
	});

	test("reads Cargo, Go, Python, just, and Make manifests", () => {
		const cargo = project("pi-check-cargo-");
		file(cargo, "Cargo.toml", '[package]\nname = "x"\n');
		expect(detectCommands(cargo)).toEqual({
			test: { command: "cargo test", label: "cargo test" },
			lint: { command: "cargo clippy -- -D warnings", label: "cargo clippy -- -D warnings" },
			typecheck: { command: "cargo check", label: "cargo check" },
		});

		const go = project("pi-check-go-");
		file(go, "go.mod", "module example.com/x\n");
		expect(detectCommands(go)?.test?.command).toBe("go test ./...");

		const python = project("pi-check-python-");
		file(python, "pyproject.toml", "[tool.pytest.ini_options]\n[tool.ruff]\n[tool.mypy]\n");
		expect(detectCommands(python)).toEqual({
			test: { command: "pytest", label: "pytest" },
			lint: { command: "ruff check .", label: "ruff check ." },
			typecheck: { command: "mypy .", label: "mypy ." },
		});

		const just = project("pi-check-just-");
		file(just, "justfile", "test:\n  cargo test\nlint:\n  cargo clippy\n");
		expect(detectCommands(just)).toEqual({
			test: { command: "just test", label: "just test" },
			lint: { command: "just lint", label: "just lint" },
		});

		const make = project("pi-check-make-");
		file(make, "Makefile", ".PHONY: test\ncheck:\n\ttrue\ntest:\n\ttrue\n");
		expect(detectCommands(make)).toEqual({
			test: { command: "make test", label: "make test" },
			all: { command: "make check", label: "make check" },
		});
	});

	test("stops at the first family that declares a command", () => {
		const dir = project("pi-check-priority-");
		file(dir, "Makefile", "test:\n\ttrue\n");
		file(dir, "package.json", JSON.stringify({ scripts: { test: "node --test" } }));
		file(dir, "package-lock.json", "{}");

		expect(detectCommands(dir)?.test?.command).toBe("npm run test");
	});

	test("returns undefined without a manifest", () => {
		expect(detectCommands(project("pi-check-empty-"))).toBeUndefined();
	});

	test("keeps the detector registry generic and ordered", () => {
		expect(DETECTORS.map((detector) => detector.name)).toEqual([
			"package.json",
			"Cargo.toml",
			"go.mod",
			"python",
			"justfile",
			"Makefile",
		]);
	});
});

describe("planCommands", () => {
	test("uses an override for every target", () => {
		expect(planCommands("/tmp", "test", "  make verify  ")).toEqual({
			ok: true,
			commands: [{ command: "make verify", label: "make verify" }],
		});
	});

	test("prefers a declared all-command, then expands the detected targets", () => {
		const dir = project("pi-check-plan-");
		file(
			dir,
			"package.json",
			JSON.stringify({ scripts: { test: "node --test", lint: "eslint .", check: "npm run test" } }),
		);

		expect(planCommands(dir, "all")).toEqual({
			ok: true,
			commands: [{ command: "npm run check", label: "npm run check" }],
		});

		file(dir, "package.json", JSON.stringify({ scripts: { test: "node --test", lint: "eslint ." } }));
		expect(planCommands(dir, "all")).toEqual({
			ok: true,
			commands: [
				{ command: "npm run test", label: "npm run test" },
				{ command: "npm run lint", label: "npm run lint" },
			],
		});
	});

	test("reports a missing target or a missing manifest", () => {
		const dir = project("pi-check-missing-");
		file(dir, "package.json", JSON.stringify({ scripts: { test: "node --test" } }));

		expect(planCommands(dir, "lint")).toMatchObject({ ok: false });
		expect(planCommands(project("pi-check-nowhere-"), "all")).toMatchObject({ ok: false });
	});
});
