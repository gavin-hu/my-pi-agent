import { describe, expect, test } from "bun:test";
import { createExtensionsManagerRuntime } from "./runtime.ts";
import { makeDiscovery, makeItem, makeStore } from "../../test/helpers/fixtures/extension-picker.ts";

const topLevel = (path: string) => makeItem({ path, metadata: { source: "auto", origin: "top-level", scope: "user" } });

const packageItem = (path: string) =>
	makeItem({
		path,
		metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/pkg/extensions" },
	});

describe("runtime toggling", () => {
	test("writes a top-level global disable pattern and flips the item", async () => {
		const store = makeStore({ global: { extensions: [] } });
		const { discovery } = makeDiscovery({ global: [topLevel("/agent/extensions/a.ts")], globalStore: store });
		const runtime = createExtensionsManagerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		const item = runtime.items()[0];
		await runtime.toggle(item);

		expect(store.calls.setExtensionPaths.at(-1)).toEqual(["-extensions/a.ts"]);
		expect(item.enabled).toBe(false);
		expect(runtime.isDirty()).toBe(true);
		expect(runtime.disabledCount()).toBe(1);
		expect(store.flushCount()).toBe(1);
	});

	test("writes a package filter through setPackages", async () => {
		const store = makeStore({ packages: ["npm:pkg"] });
		const { discovery } = makeDiscovery({ global: [packageItem("/pkg/extensions/b.ts")], globalStore: store });
		const runtime = createExtensionsManagerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		await runtime.toggle(runtime.items()[0]);

		expect(store.calls.setPackages.at(-1)).toEqual([{ source: "npm:pkg", extensions: ["-b.ts"] }]);
	});

	test("surfaces a write failure instead of flipping the item", async () => {
		const store = makeStore({ global: { extensions: [] } });
		store.failFlush(new Error("disk full"));
		const errors: string[] = [];
		const { discovery } = makeDiscovery({ global: [topLevel("/agent/extensions/a.ts")], globalStore: store });
		const runtime = createExtensionsManagerRuntime({
			discovery,
			cwd: "/proj",
			agentDir: "/agent",
			onError: (message) => errors.push(message),
		});

		const item = runtime.items()[0];
		await runtime.toggle(item);

		expect(errors).toEqual(["disk full"]);
		expect(item.enabled).toBe(true);
		expect(runtime.isDirty()).toBe(false);
	});
});

describe("runtime scope", () => {
	test("switches between global and project views when trusted", () => {
		const { discovery } = makeDiscovery({
			global: [topLevel("/agent/extensions/a.ts")],
			effective: [topLevel("/proj/extensions/p.ts")],
			trusted: true,
		});
		const runtime = createExtensionsManagerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		expect(runtime.items()[0].path).toBe("/agent/extensions/a.ts");
		runtime.setScope("project");
		expect(runtime.items()[0].path).toBe("/proj/extensions/p.ts");
	});

	test("refuses the project scope when the project is untrusted", () => {
		const { discovery } = makeDiscovery({ global: [topLevel("/agent/extensions/a.ts")], trusted: false });
		const runtime = createExtensionsManagerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });

		runtime.setScope("project");

		expect(runtime.scope()).toBe("global");
		expect(runtime.projectAvailable()).toBe(false);
	});
});
