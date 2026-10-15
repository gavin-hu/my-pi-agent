import { describe, expect, test } from "bun:test";
import { makeFinding, makeReport } from "../../../test/helpers/fixtures/doctor.ts";
import { makeItem } from "../../../test/helpers/fixtures/picker.ts";
import { buildPanelModel, extensionName, REPORT_ONLY_LABEL, resourceKey } from "./join.ts";

const packageItem = (name: string, enabled = true) =>
	makeItem({
		path: `/pkg/extensions/${name}/index.ts`,
		enabled,
		metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/pkg/extensions" },
	});

const topLevel = (path: string) => makeItem({ path });

/** A user extension beside the package's own, the collision this join guards. */
const userItem = (name: string, fileName = "index.ts") =>
	makeItem({ path: `/home/me/.pi/extensions/${name}/${fileName}` });

describe("extensionName", () => {
	test("is the extension directory, not the display name", () => {
		expect(extensionName("/pkg/extensions/web-access/index.ts")).toBe("web-access");
		expect(extensionName("/agent/extensions/a.ts")).toBe("extensions");
	});
});

describe("buildPanelModel", () => {
	test("joins a subfolder item to its report on the directory name", () => {
		const report = makeReport("web-access", [makeFinding("unpdf", "degraded")]);
		const model = buildPanelModel({ items: [packageItem("web-access")], reports: [report], agentDir: "/agent" });

		expect(model.rows).toHaveLength(1);
		expect(model.rows[0]?.label).toBe("web-access/index.ts");
		expect(model.rows[0]?.report).toBe(report);
	});

	test("keys a flat item by its resource identity and matches no report", () => {
		const item = topLevel("/agent/extensions/a.ts");
		const model = buildPanelModel({ items: [item], reports: [makeReport("plan")], agentDir: "/agent" });

		expect(model.rows[0]?.key).toBe("auto:/agent/extensions/a.ts");
		expect(model.rows[0]?.report).toBeUndefined();
	});

	test("appends a report with no item in one trailing group", () => {
		const model = buildPanelModel({
			items: [packageItem("todo")],
			reports: [makeReport("todo"), makeReport("bytefly")],
			agentDir: "/agent",
		});

		expect(model.groups.at(-1)?.label).toBe(REPORT_ONLY_LABEL);
		const last = model.rows.at(-1);
		expect(last?.key).toBe("report:bytefly");
		expect(last?.item).toBeUndefined();
		expect(last?.report?.extension).toBe("bytefly");
	});

	test("gives no report to every resource that shares a directory name, and files it under Not resolved", () => {
		const planReport = makeReport("plan", [makeFinding("git", "missing", "no git", "install git")]);
		const userPlan = userItem("plan");
		const model = buildPanelModel({
			items: [packageItem("plan"), userPlan, packageItem("todo")],
			reports: [planReport, makeReport("todo")],
			agentDir: "/agent",
		});

		const planRows = model.rows.filter((row) => row.item && extensionName(row.item.path) === "plan");
		expect(planRows).toHaveLength(2);
		expect(planRows.every((row) => row.report === undefined)).toBe(true);

		// The unshared name still claims its own report.
		const todo = model.rows.find((row) => row.item && extensionName(row.item.path) === "todo");
		expect(todo?.report?.extension).toBe("todo");

		// The unclaimed report surfaces under `Not resolved` with its findings intact.
		expect(model.groups.at(-1)?.label).toBe(REPORT_ONLY_LABEL);
		const other = model.rows.find((row) => !row.item);
		expect(other?.key).toBe("report:plan");
		expect(other?.report).toBe(planReport);
		expect(other?.report?.findings).toEqual(planReport.findings);
	});

	test("keeps distinct keys for flat items sharing a directory and gives them no health", () => {
		const first = topLevel("/agent/extensions/a.ts");
		const second = makeItem({
			path: "/pkg/extensions/b.ts",
			metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/pkg/extensions" },
		});
		const model = buildPanelModel({
			items: [first, second],
			reports: [makeReport("extensions", [makeFinding("x", "missing")])],
			agentDir: "/agent",
		});

		const itemRows = model.rows.filter((row) => row.item);
		expect(itemRows).toHaveLength(2);
		expect(new Set(itemRows.map((row) => row.key)).size).toBe(2);
		expect(itemRows.every((row) => row.report === undefined)).toBe(true);
		expect(model.rows.some((row) => !row.item && row.report?.extension === "extensions")).toBe(true);
	});

	test("preserves the picker's groups and order", () => {
		const model = buildPanelModel({
			items: [topLevel("/agent/extensions/a.ts"), packageItem("plan")],
			reports: [],
			agentDir: "/agent",
		});

		expect(model.groups).toHaveLength(2);
		expect(model.groups[0]?.label).toContain("npm:pkg");
		expect(model.rows[0]?.label).toBe("plan/index.ts");
		expect(model.rows[1]?.label).toBe("a.ts");
	});

	test("narrows to one extension directory", () => {
		const model = buildPanelModel({
			items: [packageItem("plan"), packageItem("todo")],
			reports: [makeReport("plan"), makeReport("todo")],
			agentDir: "/agent",
			filter: "todo",
		});

		expect(model.rows).toHaveLength(1);
		expect(model.rows[0]?.label).toBe("todo/index.ts");
		expect(model.groups.every((group) => group.count > 0)).toBe(true);
	});

	test("retains the focused row identity when a shared directory name is rebuilt", () => {
		const packagePlan = packageItem("plan");
		const userPlan = userItem("plan", "extra.ts");
		const before = buildPanelModel({ items: [packagePlan, userPlan], reports: [], agentDir: "/agent" });
		const planRows = before.rows.filter((row) => row.item && extensionName(row.item.path) === "plan");
		expect(planRows).toHaveLength(2);

		// Focus the second row; its key names the resource, not the directory.
		const focusedKey = planRows[1]?.key;
		expect(focusedKey).toBe(resourceKey(userPlan));

		// The list reorders (a new package sorts ahead); the key still finds it.
		const after = buildPanelModel({
			items: [packageItem("alpha"), userPlan, packagePlan],
			reports: [],
			agentDir: "/agent",
		});
		const retained = after.rows.find((row) => row.key === focusedKey);
		expect(retained?.item?.path).toBe(userPlan.path);
	});
});
