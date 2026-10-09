/**
 * Rendering a QR string as terminal lines.
 *
 * Uses the `qrcode` package only for the module matrix, then draws Unicode
 * half-blocks so two matrix rows share one terminal line. No ANSI is emitted;
 * the login screen decides colours, and the width is the matrix width plus a
 * quiet zone.
 */

import QRCode from "qrcode";

interface QrMatrix {
	size: number;
	get(row: number, col: number): boolean;
}

/** Build the module matrix for `text`. */
export function qrMatrix(text: string): QrMatrix {
	const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
	return qr.modules as unknown as QrMatrix;
}

/**
 * The QR as terminal lines. Each string is exactly `matrix.size + 2 * quiet`
 * columns wide (half-block characters are single width), so a caller can test
 * `qrLines(text)[0].length` against the terminal width.
 */
export function qrLines(text: string, options: { quiet?: number } = {}): string[] {
	const quiet = Math.max(0, options.quiet ?? 2);
	const matrix = qrMatrix(text);
	const size = matrix.size;
	const isDark = (row: number, col: number): boolean =>
		row >= 0 && col >= 0 && row < size && col < size && matrix.get(row, col);

	const lines: string[] = [];
	for (let y = -quiet; y < size + quiet; y += 2) {
		let line = "";
		for (let x = -quiet; x < size + quiet; x += 1) {
			const top = isDark(y, x);
			const bottom = isDark(y + 1, x);
			line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
		}
		lines.push(line);
	}
	return lines;
}
