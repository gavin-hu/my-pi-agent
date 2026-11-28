import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../test/helpers/env.ts";
import { makeTempTracker } from "../test/helpers/git.ts";
import {
	busPaths,
	claimsWithLiveLabels,
	dropIfEmpty,
	dropStaleTemps,
	listJson,
	publishNew,
	readJsonAs,
	storedName,
	writeJsonAtomic,
} from "./session-files.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A scratch bus directory, laid out the way the bus would lay it. */
function bus(): string {
	const dir = join(tempDir("pi-bus-files-"), "bus");
	temps.track(dir);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** A temp file a crashed writer would have left in `dir`, aged when a caller says so. */
function debris(dir: string, name: string, at?: number): string {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, name);
	writeFileSync(path, "{}");
	if (at !== undefined) utimesSync(path, at / 1000, at / 1000);
	return path;
}

describe("storedName", () => {
	test("is one digest per value, short enough for any filesystem", () => {
		const name = storedName("s-1");
		expect(name).toBe(storedName("s-1"));
		expect(name).toHaveLength(32);
		expect(name).toMatch(/^[0-9a-f]+$/);
	});

	test("keeps an id from ever becoming a path segment", () => {
		const name = storedName("../../etc/passwd");
		expect(name).not.toContain("/");
		expect(name).not.toContain("..");
		expect(storedName("s-1")).not.toBe(name);
	});
});

describe("busPaths", () => {
	test("names one directory per kind of document", () => {
		const dir = bus();
		const paths = busPaths(dir);
		expect(paths.dir).toBe(dir);
		expect(paths.sessions).toBe(join(dir, "sessions"));
		expect(paths.inbox).toBe(join(dir, "inbox"));
		expect(paths.claims).toBe(join(dir, "claims"));
	});

	test("files a session, an inbox, a claim, and a message by that one name", () => {
		const paths = busPaths(bus());
		const name = storedName("s-1");
		expect(paths.recordOf("s-1")).toBe(join(paths.sessions, `${name}.json`));
		expect(paths.inboxOf("s-1")).toBe(join(paths.inbox, name));
		expect(paths.claimOf("src/a.ts")).toBe(join(paths.claims, `${storedName("src/a.ts")}.json`));
		expect(paths.messageOf("s-1", "m-1")).toBe(join(paths.inbox, name, "m-1.json"));
	});
});

describe("listJson", () => {
	test("lists the documents in order, and nothing else", async () => {
		const dir = tempDir("pi-bus-list-");
		temps.track(dir);
		writeFileSync(join(dir, "b.json"), "{}");
		writeFileSync(join(dir, "a.json"), "{}");
		writeFileSync(join(dir, "a.json.tmp"), "{}");
		expect(await listJson(dir)).toEqual(["a.json", "b.json"]);
	});

	test("a directory that is not there holds none", async () => {
		expect(await listJson(join(tempDir("pi-bus-absent-"), "nothing"))).toEqual([]);
	});
});

describe("claimsWithLiveLabels", () => {
	/** A claim as the bus stores it: the label captured at the write, before any reader resolves it. */
	const claim = (owner: string, ownerLabel: string) => ({ path: "src/api", owner, ownerLabel, at: 100 });

	test("names a claim by its owner's current label, keeping the rest of the record", () => {
		expect(claimsWithLiveLabels([claim("s-1", "billing-core")], [{ id: "s-1", label: "renamed-core" }])).toEqual([
			{ path: "src/api", owner: "s-1", ownerLabel: "renamed-core", at: 100 },
		]);
	});

	test("keeps the captured label for an owner no record names", () => {
		expect(claimsWithLiveLabels([claim("s-1", "billing-core")], [{ id: "s-2", label: "peer" }])).toEqual([
			claim("s-1", "billing-core"),
		]);
	});

	test("returns the claim itself where the names already agree", () => {
		const kept = claim("s-1", "billing-core");
		expect(claimsWithLiveLabels([kept], [{ id: "s-1", label: "billing-core" }])[0]).toBe(kept);
	});
});

describe("readJsonAs", () => {
	const isPoint = (value: unknown): value is { x: number } =>
		typeof value === "object" && value !== null && typeof (value as { x?: unknown }).x === "number";

	test("returns the document its guard accepts", () => {
		const path = join(bus(), "point.json");
		writeFileSync(path, JSON.stringify({ x: 1 }));
		expect(readJsonAs(path, isPoint)).toEqual({ x: 1 });
	});

	test("a document the guard refuses, or one that is not there, is undefined", () => {
		const dir = bus();
		const wrong = join(dir, "wrong.json");
		writeFileSync(wrong, JSON.stringify({ y: 1 }));
		expect(readJsonAs(wrong, isPoint)).toBeUndefined();
		expect(readJsonAs(join(dir, "absent.json"), isPoint)).toBeUndefined();
	});
});

describe("writeJsonAtomic", () => {
	test("creates its parents and replaces what is there, whole", async () => {
		const path = join(bus(), "deep/deeper/doc.json");
		await writeJsonAtomic(path, { n: 1 });
		expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ n: 1 });
		await writeJsonAtomic(path, { n: 2 });
		expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ n: 2 });
	});

	test("publishes through a temp that is gone afterwards", async () => {
		const dir = bus();
		await writeJsonAtomic(join(dir, "doc.json"), { n: 1 });
		expect(readdirSync(dir)).toEqual(["doc.json"]);
	});

	test("ends the document with a newline, as every other writer here does", async () => {
		const path = join(bus(), "doc.json");
		await writeJsonAtomic(path, { n: 1 });
		expect(readFileSync(path, "utf-8").endsWith("}\n")).toBe(true);
	});
});

describe("publishNew", () => {
	test("creates a document once and refuses the second create", async () => {
		const path = join(bus(), "claim.json");
		expect(await publishNew(path, { owner: "s-1" })).toBe(true);
		expect(await publishNew(path, { owner: "s-2" })).toBe(false);
		expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ owner: "s-1" });
	});

	test("leaves no temp behind, whether it published or lost", async () => {
		const dir = bus();
		const path = join(dir, "claim.json");
		await publishNew(path, { owner: "s-1" });
		await publishNew(path, { owner: "s-2" });
		expect(readdirSync(dir)).toEqual(["claim.json"]);
	});

	test("creates the directory it publishes into", async () => {
		const dir = join(bus(), "claims/deep");
		expect(await publishNew(join(dir, "claim.json"), { owner: "s-1" })).toBe(true);
		expect(statSync(dir).isDirectory()).toBe(true);
	});
});

describe("dropIfEmpty", () => {
	test("removes a directory holding nothing", async () => {
		const dir = join(bus(), "inbox/one");
		mkdirSync(dir, { recursive: true });
		await dropIfEmpty(dir);
		expect(() => statSync(dir)).toThrow();
	});

	test("keeps one that holds a file, and one that is not there", async () => {
		const dir = join(bus(), "inbox/two");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "m.json"), "{}");
		await dropIfEmpty(dir);
		expect(readdirSync(dir)).toEqual(["m.json"]);
		await dropIfEmpty(join(bus(), "inbox/absent"));
	});
});

describe("dropStaleTemps", () => {
	test("removes debris and nothing a reader lists", async () => {
		const dir = bus();
		const old = debris(dir, "doc.json.1234.abcd.tmp", 1_000);
		const fresh = debris(dir, "doc.json.1234.ef01.tmp");
		const document = join(dir, "doc.json");
		writeFileSync(document, "{}");
		await dropStaleTemps(dir);
		expect(() => statSync(old)).toThrow();
		expect(readdirSync(dir).sort()).toEqual(["doc.json", "doc.json.1234.ef01.tmp"].sort());
		expect(() => statSync(fresh)).not.toThrow();
	});
});
