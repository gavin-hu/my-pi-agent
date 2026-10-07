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

/**
 * Expand an IPv6 literal to its eight 16-bit groups. Accepts a dotted IPv4
 * suffix (`::ffff:127.0.0.1`), a zone id (`fe80::1%eth0`), and `::`
 * compression. Returns `undefined` for anything malformed.
 */
function expandIpv6(input: string): number[] | undefined {
	let ip = input.toLowerCase().split("%")[0];

	const dotted = ip.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
	if (dotted) {
		const parts = dotted[1].split(".").map((part) => Number(part));
		if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
		const high = ((parts[0] << 8) | parts[1]).toString(16);
		const low = ((parts[2] << 8) | parts[3]).toString(16);
		ip = `${ip.slice(0, dotted.index)}${high}:${low}`;
	}

	const parseGroups = (part: string): number[] | undefined => {
		if (part === "") return [];
		const groups: number[] = [];
		for (const group of part.split(":")) {
			if (!/^[0-9a-f]{1,4}$/.test(group)) return undefined;
			groups.push(Number.parseInt(group, 16));
		}
		return groups;
	};

	const halves = ip.split("::");
	if (halves.length > 2) return undefined;
	const head = parseGroups(halves[0]);
	if (!head) return undefined;
	if (halves.length === 2) {
		const tail = parseGroups(halves[1]);
		if (!tail) return undefined;
		const missing = 8 - head.length - tail.length;
		if (missing < 1) return undefined;
		return [...head, ...new Array<number>(missing).fill(0), ...tail];
	}
	return head.length === 8 ? head : undefined;
}

/** The IPv4 address in the low 32 bits of an expanded IPv6 address. */
function embeddedIpv4(groups: number[]): string {
	return `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
}

function isBlockedIpv6(raw: string): boolean {
	const g = expandIpv6(raw);
	if (!g) return true; // malformed: fail closed

	if (g.every((group) => group === 0)) return true; // ::
	if (g.slice(0, 7).every((group) => group === 0) && g[7] === 1) return true; // ::1

	// 6to4 (2002::/16) embeds an IPv4 address in groups 1-2.
	if (g[0] === 0x2002 && isBlockedIpv4(`${g[1] >> 8}.${g[1] & 0xff}.${g[2] >> 8}.${g[2] & 0xff}`)) {
		return true;
	}
	// IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), IPv4-translated
	// (::ffff:0:a.b.c.d), and NAT64 (64:ff9b::a.b.c.d) embed an IPv4 address.
	const mapped = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff;
	const compatible = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0;
	const translated = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0xffff && g[5] === 0;
	const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0;
	if ((mapped || compatible || translated || nat64) && isBlockedIpv4(embeddedIpv4(g))) return true;

	if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
	if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
	if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
	if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 2001:db8::/32 documentation
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
