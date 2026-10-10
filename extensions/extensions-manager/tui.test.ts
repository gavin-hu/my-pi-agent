import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createExtensionsManagerRuntime } from "./runtime.ts";
import { ExtensionsListComponent } from "./tui.ts";
import { makeDiscovery, makeItem, makeStore } from "../../test/helpers/fixtures/extensions-manager.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";

/** Let a fire-and-forget toggle settle. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const topLevel = (path: string) => makeItem({ path, metadata: { source: "auto", origin: "top-level", scope: "user" } });

const packageItem = (path: string) =>
	makeItem({
		path,
		metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/pkg/extensions" },
	});

function build(options: {
	items: ReturnType<typeof makeItem>[];
	trusted?: boolean;
	store?: ReturnType<typeof makeStore>;
	width?: number;
}) {
	const store = options.store ?? makeStore();
	const { discovery } = makeDiscovery({ global: options.items, globalStore: store, trusted: options.trusted ?? true });
	const runtime = createExtensionsManagerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });
	let closed = 0;
	const notices: string[] = [];
	const component = new ExtensionsListComponent(
		runtime,
		fakeTheme,
		"/agent",
		() => {
			closed += 1;
		},
		() => {},
		options.width ?? 30,
		(message) => notices.push(message),
	);
	return { component, runtime, store, notices, closedCount: () => closed };
}

describe("ExtensionsListComponent rendering", () => {
	test("shows the scope, checkboxes, and group headers within the width", () => {
		const { component } = build({
			items: [topLevel("/agent/extensions/one.ts"), makeItem({ path: "/agent/extensions/two.ts", enabled: false })],
		});

		const lines = component.render(30);
		const text = lines.join("\n");

		expect(text).toContain("Scope: Global");
		expect(text).toContain("[x] one.ts");
		expect(text).toContain("[ ] two.ts");
		expect(lines.every((line) => visibleWidth(line) <= 30)).toBe(true);
	});

	test("reports an empty result", () => {
		const { component } = build({ items: [] });
		expect(component.render(30).join("\n")).toContain("No extensions found.");
	});
});

describe("ExtensionsListComponent input", () => {
	test("navigation skips group headers", async () => {
		const { component, store } = build({
			items: [packageItem("/pkg/extensions/pkg.ts"), topLevel("/agent/extensions/auto.ts")],
		});

		// Starts on the package item; `j` steps past the top-level header.
		component.handleInput("j");
		component.handleInput(" ");
		await settle();

		expect(store.calls.setExtensionPaths.at(-1)).toEqual(["-extensions/auto.ts"]);
	});

	test("space toggles the focused item and marks the screen dirty", async () => {
		const { component } = build({ items: [topLevel("/agent/extensions/one.ts")] });

		component.handleInput(" ");
		await settle();

		expect(component.render(30).join("\n")).toContain("Pending changes");
	});

	test("Tab warns instead of switching when the project is untrusted", () => {
		const { component, runtime, notices } = build({ items: [topLevel("/agent/extensions/one.ts")], trusted: false });

		component.handleInput("\t");

		expect(runtime.scope()).toBe("global");
		expect(notices.at(-1)).toContain("not trusted");
	});

	test("Escape closes the screen", () => {
		const { component, closedCount } = build({ items: [topLevel("/agent/extensions/one.ts")] });

		component.handleInput("\u001b");

		expect(closedCount()).toBe(1);
	});
});
