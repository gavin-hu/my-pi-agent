/**
 * Contrast, for the suites that hold a colour to a WCAG ratio.
 *
 * Two files ask the same question — is this pair readable — so the arithmetic lives here once:
 * the kit's token suite asks it of a palette, and the board's asks it of a card's paper, where the
 * lane tint is an alpha over a surface rather than a token. A body copied into the second suite is
 * the drift `test/shared-helpers.test.ts` fails.
 */

/** `#rrggbb` (or `#rgb`) and `rgba(r,g,b,a)` as channels. */
function channels(colour: string): { rgb: [number, number, number]; alpha: number } {
	const hex = colour.trim();
	const rgba = /^rgba?\(([^)]+)\)$/.exec(hex);
	if (rgba !== null) {
		const parts = (rgba[1] as string).split(",").map((part) => Number.parseFloat(part.trim()));
		return { rgb: [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0], alpha: parts[3] ?? 1 };
	}
	const raw = hex.replace("#", "");
	const full =
		raw.length === 3
			? raw
					.split("")
					.map((char) => char + char)
					.join("")
			: raw;
	return {
		rgb: [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16)) as [number, number, number],
		alpha: 1,
	};
}

/** One colour laid over an opaque one: what a lane's tinted paper is. */
export function over(top: string, bottom: string): string {
	const { rgb, alpha } = channels(top);
	const base = channels(bottom).rgb;
	return `#${rgb
		.map((channel, at) =>
			Math.round(channel * alpha + (base[at] ?? 0) * (1 - alpha))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
}

/** WCAG relative luminance. */
function luminance(colour: string): number {
	const [r, g, b] = channels(colour).rgb.map((channel) => {
		const value = channel / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio between two colours, 1..21. */
export function contrast(a: string, b: string): number {
	const [lighter, darker] = [luminance(a), luminance(b)].sort((left, right) => right - left);
	return (lighter + 0.05) / (darker + 0.05);
}
