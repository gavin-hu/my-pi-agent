import { describe, expect, test } from "bun:test";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import { createResolver, discoverExtensions, type DiscoveryFactory, type ResolverManager } from "./discovery.ts";
import { makeItem, makeStore } from "../../test/helpers/fixtures/extensions-manager.ts";

const item = (path: string) => makeItem({ path });

describe("discoverExtensions", () => {
	test("resolves the global view then the project view when trusted", async () => {
		const calls: string[] = [];
		const factory: DiscoveryFactory = {
			global: () => ({
				store: makeStore().store,
				resolve: async () => {
					calls.push("global");
					return [item("/global.ts")];
				},
			}),
			project: () => ({
				store: makeStore().store,
				resolve: async () => {
					calls.push("project");
					return [item("/project.ts")];
				},
			}),
		};

		const discovery = await discoverExtensions({ cwd: "/proj", agentDir: "/agent", trusted: true, factory });

		expect(calls).toEqual(["global", "project"]);
		expect(discovery.global[0].path).toBe("/global.ts");
		expect(discovery.effective[0].path).toBe("/project.ts");
		expect(discovery.stores.project).not.toBe(discovery.stores.global);
	});

	test("reuses the global view and store when the project is untrusted", async () => {
		const store = makeStore().store;
		const factory: DiscoveryFactory = {
			global: () => ({ store, resolve: async () => [item("/global.ts")] }),
			project: () => {
				throw new Error("project view must not be built when untrusted");
			},
		};

		const discovery = await discoverExtensions({ cwd: "/proj", agentDir: "/agent", trusted: false, factory });

		expect(discovery.trusted).toBe(false);
		expect(discovery.effective).toBe(discovery.global);
		expect(discovery.stores.project).toBe(discovery.stores.global);
	});
});

describe("createResolver", () => {
	test("passes a skip handler so missing sources are never installed", async () => {
		let action: string | undefined;
		const manager: ResolverManager = {
			resolve: async (onMissing) => {
				action = await onMissing?.("missing");
				return { extensions: [] };
			},
		};
		const resolver = createResolver(undefined as unknown as SettingsManager, "/proj", "/agent", manager);

		await resolver.resolve();

		expect(action).toBe("skip");
	});
});
