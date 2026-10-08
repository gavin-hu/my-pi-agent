import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../extensions/serve/config.ts";
import { createFileServer, type FileServer } from "../../extensions/serve/server.ts";
import { makeFixture, type Fixture } from "./helpers.ts";

let fixture: Fixture | undefined;
let server: FileServer | undefined;

afterEach(async () => {
	await server?.close();
	server = undefined;
	fixture?.remove();
	fixture = undefined;
});

describe("createFileServer", () => {
	test("serves listings, files, and the tree API over HTTP", async () => {
		fixture = makeFixture();
		server = await createFileServer({ root: fixture.root, config: { ...DEFAULT_CONFIG, autoOpen: false } });
		expect(server.port).toBeGreaterThan(0);
		expect(server.url.startsWith("http://127.0.0.1:")).toBe(true);

		const home = await fetch(server.url);
		expect(home.status).toBe(200);
		expect(await home.text()).toContain("read-only");

		const file = await fetch(`${server.url}view/a.txt`);
		expect(file.status).toBe(200);
		expect(await file.text()).toContain("hello");

		const tree = await fetch(`${server.url}api/tree?path=sub`);
		expect(tree.status).toBe(200);
		expect((await tree.json()) as { path: string }).toMatchObject({ path: "sub" });
	});

	test("responds to HEAD without a body", async () => {
		fixture = makeFixture();
		server = await createFileServer({ root: fixture.root, config: DEFAULT_CONFIG });
		const response = await fetch(server.url, { method: "HEAD" });
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");
	});

	test("closes idempotently and stops accepting connections", async () => {
		fixture = makeFixture();
		const started = await createFileServer({ root: fixture.root, config: DEFAULT_CONFIG });
		const url = started.url;
		await started.close();
		await started.close();
		server = undefined;
		await expect(fetch(url)).rejects.toThrow();
	});
});
