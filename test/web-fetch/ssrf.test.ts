import { describe, expect, test } from "bun:test";
import { assertAllowedUrl, isBlockedHostname, isBlockedIp, SsrfError, type LookupImpl } from "../../extensions/web-fetch/ssrf.ts";

function lookupReturning(...addresses: string[]): LookupImpl {
	return (async () => addresses.map((address) => ({ address }))) as unknown as LookupImpl;
}

describe("isBlockedIp", () => {
	test("blocks loopback, private, link-local, and metadata ranges", () => {
		for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "224.0.0.1"]) {
			expect(isBlockedIp(ip)).toBe(true);
		}
	});

	test("blocks IPv6 loopback, unique-local, and link-local", () => {
		for (const ip of ["::1", "::", "fc00::1", "fe80::1", "::ffff:127.0.0.1"]) {
			expect(isBlockedIp(ip)).toBe(true);
		}
	});

	test("blocks every encoding of an embedded IPv4 address", () => {
		for (const ip of [
			"::ffff:127.0.0.1", // IPv4-mapped, dotted
			"::ffff:7f00:1", // IPv4-mapped, hex
			"0:0:0:0:0:ffff:7f00:1", // IPv4-mapped, uncompressed
			"::7f00:1", // IPv4-compatible
			"::ffff:0:7f00:1", // IPv4-translated
			"64:ff9b::7f00:1", // NAT64 to loopback
			"64:ff9b::a00:1", // NAT64 to 10.0.0.1
			"2002:7f00:0001::", // 6to4 to loopback
		]) {
			expect(isBlockedIp(ip)).toBe(true);
		}
		// NAT64/6to4 to a public address stays allowed.
		expect(isBlockedIp("64:ff9b::808:808")).toBe(false);
		expect(isBlockedIp("2002:0808:0808::")).toBe(false);
	});

	test("allows public addresses", () => {
		for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) {
			expect(isBlockedIp(ip)).toBe(false);
		}
	});
});

describe("isBlockedHostname", () => {
	test("blocks obvious internal names", () => {
		for (const host of ["localhost", "sub.localhost", "foo.local", "x.internal", "metadata.google.internal"]) {
			expect(isBlockedHostname(host)).toBe(true);
		}
	});

	test("allows normal public names", () => {
		for (const host of ["example.com", "en.wikipedia.org"]) {
			expect(isBlockedHostname(host)).toBe(false);
		}
	});
});

describe("assertAllowedUrl", () => {
	test("accepts a public http(s) url", async () => {
		const url = await assertAllowedUrl("https://example.com/page", false, lookupReturning("93.184.216.34"));
		expect(url.hostname).toBe("example.com");
	});

	test("rejects a non-http scheme and invalid urls", async () => {
		await expect(assertAllowedUrl("ftp://example.com/", false, lookupReturning("1.1.1.1"))).rejects.toThrow(SsrfError);
		await expect(assertAllowedUrl("not a url", false, lookupReturning("1.1.1.1"))).rejects.toThrow(SsrfError);
	});

	test("rejects internal hostnames and literal addresses", async () => {
		await expect(assertAllowedUrl("http://localhost:8080/", false, lookupReturning("127.0.0.1"))).rejects.toThrow(SsrfError);
		await expect(assertAllowedUrl("http://10.0.0.5/", false, lookupReturning("10.0.0.5"))).rejects.toThrow(SsrfError);
	});

	test("rejects a public name that resolves to a private address", async () => {
		await expect(assertAllowedUrl("https://evil.example/", false, lookupReturning("10.0.0.1"))).rejects.toThrow(SsrfError);
	});

	test("reports a resolution failure", async () => {
		const failing = (async () => {
			throw new Error("ENOTFOUND");
		}) as unknown as LookupImpl;
		await expect(assertAllowedUrl("https://nope.example/", false, failing)).rejects.toThrow(/Could not resolve/);
	});

	test("skips checks when private hosts are allowed", async () => {
		const failIfCalled = (async () => {
			throw new Error("should not resolve");
		}) as unknown as LookupImpl;
		const url = await assertAllowedUrl("http://localhost/", true, failIfCalled);
		expect(url.hostname).toBe("localhost");
	});
});
