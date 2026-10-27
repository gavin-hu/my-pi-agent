import { describe, expect, test } from "bun:test";
import {
	createLinkTable,
	lanAddresses,
	MAX_SHARE_LINKS,
	NO_SHARE_REASON,
	shareUrl,
	type NetworkInterfaces,
} from "./web-share.ts";

/** One IPv4 interface entry, with the fields the selector reads. */
function entry(address: string, options: { internal?: boolean } = {}) {
	return {
		address,
		netmask: "255.255.255.0",
		family: "IPv4" as const,
		mac: "00:00:00:00:00:00",
		internal: options.internal ?? false,
		cidr: `${address}/24`,
	};
}

/** One IPv6 interface entry, which sharing never offers. */
function entry6(address: string) {
	return {
		address,
		netmask: "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
		family: "IPv6" as const,
		mac: "00:00:00:00:00:00",
		internal: false,
		cidr: `${address}/64`,
		scopeid: 0,
	};
}

describe("lanAddresses", () => {
	test("returns the reachable IPv4 addresses in numeric order", () => {
		const interfaces: NetworkInterfaces = {
			en0: [entry("192.168.1.24"), entry("192.168.1.9")],
			en1: [entry("10.0.0.2")],
		};
		expect(lanAddresses(interfaces)).toEqual(["10.0.0.2", "192.168.1.9", "192.168.1.24"]);
	});

	test("skips loopback, IPv6, and the link-local range DHCP failure leaves", () => {
		const interfaces: NetworkInterfaces = {
			lo0: [entry("127.0.0.1", { internal: true })],
			en0: [entry("169.254.13.7"), entry6("fe80::1")],
		};
		expect(lanAddresses(interfaces)).toEqual([]);
	});

	test("ignores an interface the OS reports without entries", () => {
		expect(lanAddresses({ en0: undefined })).toEqual([]);
	});

	test("deduplicates one address bound to two interfaces", () => {
		expect(lanAddresses({ en0: [entry("192.168.1.24")], en5: [entry("192.168.1.24")] })).toEqual(["192.168.1.24"]);
	});
});

describe("shareUrl", () => {
	test("builds a tokenized link from the origin and the review's own prefix", () => {
		expect(shareUrl("/plan/3f9c21aa", "http://192.168.1.24:51789", "abc")).toBe(
			"http://192.168.1.24:51789/plan/3f9c21aa/?token=abc",
		);
	});
});

/** A table whose tokens are countable, so a link's identity is visible in a failure. */
function table(names: Record<string, string> = {}) {
	let minted = 0;
	const revoked: string[] = [];
	const links = createLinkTable({
		mint: () => {
			minted += 1;
			return `tok-${minted}`;
		},
		revoke: (token) => revoked.push(token),
		nameOf: (token) => names[token],
	});
	return { links, revoked, minted: () => minted };
}

describe("createLinkTable", () => {
	test("names each link once and builds its URL from the origin and the review", () => {
		const { links } = table();
		expect(links.add()).toEqual({ id: "link-1", token: "tok-1" });
		expect(links.add()).toEqual({ id: "link-2", token: "tok-2" });
		expect(links.state("/plan/3f9c21aa", "http://192.168.1.24:51789", "192.168.1.24")).toEqual({
			sharing: true,
			origin: "http://192.168.1.24:51789",
			links: [
				{ id: "link-1", address: "192.168.1.24", url: "http://192.168.1.24:51789/plan/3f9c21aa/?token=tok-1" },
				{ id: "link-2", address: "192.168.1.24", url: "http://192.168.1.24:51789/plan/3f9c21aa/?token=tok-2" },
			],
		});
	});

	test("releases one link's token without touching the others", () => {
		const { links, revoked } = table();
		links.add();
		links.add();
		expect(links.remove("link-1")).toBe(true);
		expect(revoked).toEqual(["tok-1"]);
		expect(links.list().map((link) => link.id)).toEqual(["link-2"]);
	});

	test("refuses an id it does not hold, and never reuses one", () => {
		const { links } = table();
		links.add();
		expect(links.remove("link-9")).toBe(false);
		links.remove("link-1");
		expect(links.add()?.id).toBe("link-2");
	});

	test("reports nothing shared once the last link is gone", () => {
		const { links } = table();
		links.add();
		links.remove("link-1");
		expect(links.state("/plan/3f9c21aa", "http://192.168.1.24:51789", "192.168.1.24")).toEqual({
			sharing: false,
			origin: "http://192.168.1.24:51789",
			links: [],
		});
	});

	test("reports each link's bound name, so the owner can see who holds it", () => {
		const { links } = table({ "tok-2": "priya" });
		links.add();
		links.add();
		const [first, second] = links.state("/plan/3f9c21aa", "http://192.168.1.24:51789", "192.168.1.24").links;
		expect(first).not.toHaveProperty("name");
		expect(second?.name).toBe("priya");
	});

	test("stops minting at the cap, because every link is a live credential", () => {
		const { links } = table();
		for (let index = 0; index < MAX_SHARE_LINKS; index++) expect(links.add()).toBeDefined();
		expect(links.add()).toBeUndefined();
		expect(links.list()).toHaveLength(MAX_SHARE_LINKS);
	});
});

describe("NO_SHARE_REASON", () => {
	test("names the consequence, not just the fact", () => {
		expect(NO_SHARE_REASON).toContain("network address");
		expect(NO_SHARE_REASON).toContain("loopback");
	});
});
