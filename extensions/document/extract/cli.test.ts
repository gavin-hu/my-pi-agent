import { describe, expect, test } from "bun:test";
import { createFakePi } from "../../../test/helpers/fakes.ts";
import {
	CliUnavailableError,
	cliGuidance,
	createDocCli,
	createExecRunner,
	type CliResult,
	type RunCli,
} from "./cli.ts";

/** A scripted runner: each call pops the next result, or throws an Error entry. */
function stubRun(results: Array<CliResult | Error>): {
	run: RunCli;
	calls: Array<{ command: string; args: string[] }>;
} {
	const calls: Array<{ command: string; args: string[] }> = [];
	let index = 0;
	const run: RunCli = async (command, args) => {
		calls.push({ command, args: [...args] });
		const next = results[index++];
		if (next instanceof Error) throw next;
		return next;
	};
	return { run, calls };
}

describe("createDocCli", () => {
	test("returns stdout for a clean exit", async () => {
		const { run } = stubRun([{ stdout: "hello", stderr: "", code: 0 }]);
		expect(await createDocCli(run).run("pdfcraft-cli", ["text", "a.pdf"])).toBe("hello");
	});

	test("surfaces stderr for a non-zero exit with a message", async () => {
		const { run, calls } = stubRun([{ stdout: "", stderr: "bad file\n", code: 1 }]);
		await expect(createDocCli(run).run("wordcraft-cli", ["text", "a.docx"])).rejects.toThrow("bad file");
		// A reported failure is real, so no availability probe runs.
		expect(calls).toHaveLength(1);
	});

	test("classifies a silent failure as a missing CLI when the probe fails", async () => {
		const { run, calls } = stubRun([
			{ stdout: "", stderr: "", code: 1 },
			{ stdout: "", stderr: "", code: 1 },
		]);
		const error = await createDocCli(run)
			.run("gridcraft-cli", ["cat", "a.xlsx"])
			.catch((caught) => caught);
		expect(error).toBeInstanceOf(CliUnavailableError);
		expect((error as Error).message).toContain(
			"cargo install --git https://github.com/storytold/gridcraft gridcraft-cli",
		);
		expect(calls[1]).toEqual({ command: "gridcraft-cli", args: ["--version"] });
	});

	test("reports a plain exit when a silent failure is not a missing CLI", async () => {
		const { run } = stubRun([
			{ stdout: "", stderr: "", code: 2 },
			{ stdout: "pdfcraft-cli 1.2.3\n", stderr: "", code: 0 },
		]);
		await expect(createDocCli(run).run("pdfcraft-cli", ["text", "a.pdf"])).rejects.toThrow(
			"pdfcraft-cli exited with code 2.",
		);
	});

	test("classifies a throwing probe as a missing CLI", async () => {
		const { run } = stubRun([{ stdout: "", stderr: "", code: 1 }, new Error("spawn ENOENT")]);
		await expect(createDocCli(run).run("wordcraft-cli", ["text", "a.docx"])).rejects.toBeInstanceOf(
			CliUnavailableError,
		);
	});
});

describe("createExecRunner", () => {
	test("maps pi.exec to the runner result", async () => {
		const seen: Array<{ command: string; args: string[] }> = [];
		const { pi } = createFakePi({
			exec: async (command, args) => {
				seen.push({ command, args: [...args] });
				return { stdout: "out", stderr: "err", code: 0, killed: false };
			},
		});
		const result = await createExecRunner(pi)("pdfcraft-cli", ["text", "a.pdf"]);
		expect(result).toEqual({ stdout: "out", stderr: "err", code: 0, killed: false });
		expect(seen).toEqual([{ command: "pdfcraft-cli", args: ["text", "a.pdf"] }]);
	});
});

describe("cliGuidance", () => {
	test("names the install command and repository per CLI", () => {
		expect(cliGuidance("pdfcraft-cli")).toContain("storytold/pdfcraft");
		expect(cliGuidance("wordcraft-cli")).toContain("storytold/wordcraft");
		expect(cliGuidance("gridcraft-cli")).toContain("storytold/gridcraft");
		expect(cliGuidance("gridcraft-cli")).toContain("XLSX extraction");
	});
});
