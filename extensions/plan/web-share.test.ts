import { describe, expect, test } from "bun:test";
import { lanAddresses, NO_SHARE_REASON, shareUrls, type NetworkInterfaces } from "./web-share.ts";

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

describe("shareUrls", () => {
	test("builds a tokenized link for each address", () => {
		expect(shareUrls(["192.168.1.24"], 51789, "abc")).toEqual([
			{ address: "192.168.1.24", url: "http://192.168.1.24:51789/?token=abc" },
		]);
	});

	test("builds nothing when there is no address", () => {
		expect(shareUrls([], 51789, "abc")).toEqual([]);
	});
});

describe("NO_SHARE_REASON", () => {
	test("names the consequence, not just the fact", () => {
		expect(NO_SHARE_REASON).toContain("network address");
		expect(NO_SHARE_REASON).toContain("loopback");
	});
});
