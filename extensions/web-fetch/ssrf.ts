/**
 * Best-effort SSRF guard for `web_fetch`.
 *
 * `web_fetch` will happily follow links to internal addresses otherwise. This
 * rejects non-http(s) URLs, obvious internal hostnames, and hosts that resolve
 * to loopback, private, link-local, unique-local, multicast, or metadata
 * addresses. `allowPrivateHosts` opts out.
 *
 * It is defense-in-depth, not a sandbox: DNS can change between this check and
 * the request (rebinding), and `fetch` follows redirects internally.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class SsrfError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SsrfError";
	}
}

const BLOCKED_HOSTNAMES = new Set([
	"localhost",
	"metadata",
	"metadata.google.internal",
	"metadata.goog",
	"instance-data",
]);

function ipv4ToInt(ip: string): number {
	const parts = ip.split(".").map((part) => Number(part));
	return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inRange(ip: number, base: number, prefix: number): boolean {
	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
	return (ip & mask) === (base & mask);
}

function isBlockedIpv4(ip: string): boolean {
	const value = ipv4ToInt(ip);
	const ranges: Array<[string, number]> = [
		["0.0.0.0", 8],
		["10.0.0.0", 8],
		["100.64.0.0", 10],
		["127.0.0.0", 8],
		["169.254.0.0", 16],
		["172.16.0.0", 12],
		["192.0.0.0", 24],
		["192.0.2.0", 24],
		["192.168.0.0", 16],
		["198.18.0.0", 15],
		["198.51.100.0", 24],
		["203.0.113.0", 24],
		["224.0.0.0", 4],
		["240.0.0.0", 4],
	];
	return ranges.some(([base, prefix]) => inRange(value, ipv4ToInt(base), prefix));
}

function isBlockedIpv6(raw: string): boolean {
	const ip = raw.toLowerCase();
	// IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::/96) embed an IPv4 address.
	const embedded = ip.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
	if (embedded) return isBlockedIpv4(embedded[1]);

	if (ip === "::" || ip === "::1") return true;
	const bytes = ip.split(":").filter(Boolean);
	const first = bytes[0] ?? "";
	const firstValue = Number.parseInt(first || "0", 16);
	if ((firstValue & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
	if ((firstValue & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
	if ((firstValue & 0xff00) === 0xff00) return true; // ff00::/8 multicast
	if (ip.startsWith("2001:db8:")) return true; // documentation
	return false;
}

/** True when an IP literal is loopback/private/link-local/metadata/etc. */
export function isBlockedIp(ip: string): boolean {
	const version = isIP(ip);
	if (version === 4) return isBlockedIpv4(ip);
	if (version === 6) return isBlockedIpv6(ip);
	return true;
}

/** True for obviously internal hostnames. */
export function isBlockedHostname(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/\.$/, "");
	if (BLOCKED_HOSTNAMES.has(host)) return true;
	return host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal");
}

export type LookupImpl = typeof lookup;

/**
 * Validate a URL, resolving the host unless private hosts are allowed. Throws
 * `SsrfError` when the target is not an allowed public http(s) URL.
 */
export async function assertAllowedUrl(raw: string, allowPrivate: boolean, lookupImpl: LookupImpl = lookup): Promise<URL> {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new SsrfError("url must be a valid absolute URL.");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new SsrfError("url must use http or https.");
	}
	if (allowPrivate) return url;

	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	if (isBlockedHostname(hostname)) {
		throw new SsrfError(`Refusing to fetch internal host "${hostname}".`);
	}
	if (isIP(hostname)) {
		if (isBlockedIp(hostname)) throw new SsrfError(`Refusing to fetch internal address "${hostname}".`);
		return url;
	}

	let addresses: Array<{ address: string }>;
	try {
		addresses = await lookupImpl(hostname, { all: true });
	} catch {
		throw new SsrfError(`Could not resolve host "${hostname}".`);
	}
	if (addresses.some((entry) => isBlockedIp(entry.address))) {
		throw new SsrfError(`Refusing to fetch "${hostname}": it resolves to an internal address.`);
	}
	return url;
}
