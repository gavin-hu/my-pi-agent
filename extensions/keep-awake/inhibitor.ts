/**
 * Pure builders for the per-platform OS keep-awake command.
 *
 * Every command is self-terminating when it can be: `caffeinate -w <pid>` and
 * the Linux/PowerShell loops watch the Pi process, so a hard crash of Pi does
 * not leave an inhibitor holding the machine awake. The commands are
 * otherwise killed by process group at shutdown (see `runtime.ts`).
 */

export interface InhibitorOptions {
	/** Also prevent display sleep/blanking. */
	keepDisplay: boolean;
	/** The Pi process the inhibitor should follow. */
	piPid: number;
}

/** `caffeinate` flags: `-i` blocks idle sleep, `-d` also blocks display sleep. */
function caffeinateFlags(keepDisplay: boolean): string {
	return keepDisplay ? "-d -i" : "-i";
}

/**
 * The PowerShell program that holds `SetThreadExecutionState` until `piPid`
 * exits. `ES_CONTINUOUS` keeps the request in force until the thread clears it
 * or the process ends; `ES_SYSTEM_REQUIRED` prevents system sleep and
 * `ES_DISPLAY_REQUIRED` prevents display sleep.
 */
export function powershellScript(keepDisplay: boolean, piPid: number): string {
	// Emit an unsigned decimal cast: PowerShell parses a hex literal such as
	// `0x80000001` as a signed Int32 (-2147483647) and refuses to marshal it into
	// the `uint` parameter, throwing instead of setting the state. `>>> 0` keeps
	// the flags positive and `[uint32]` makes the intent explicit.
	const flags = (0x80000000 | 0x00000001 | (keepDisplay ? 0x00000002 : 0)) >>> 0;
	return [
		`$sig = '[DllImport("kernel32.dll", SetLastError=true)] public static extern uint SetThreadExecutionState(uint es);'`,
		"$type = Add-Type -MemberDefinition $sig -Name KeepAwake -Namespace Pi -PassThru",
		`[void]$type::SetThreadExecutionState([uint32]${flags})`,
		`while (Get-Process -Id ${piPid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 5 }`,
	].join("; ");
}

/** UTF-16LE/base64 as `powershell -EncodedCommand` expects, so quoting never breaks. */
export function encodePowerShell(script: string): string {
	return Buffer.from(script, "utf16le").toString("base64");
}

/**
 * The shell command that keeps `platform` awake, or `undefined` when the
 * platform has no supported inhibitor.
 */
export function buildInhibitorCommand(platform: NodeJS.Platform, opts: InhibitorOptions): string | undefined {
	switch (platform) {
		case "darwin":
			return `caffeinate ${caffeinateFlags(opts.keepDisplay)} -w ${opts.piPid}`;
		case "linux": {
			// `idle` blocks idle/screen blanking; `sleep` blocks suspend/hibernate.
			const what = opts.keepDisplay ? "idle:sleep" : "sleep";
			return `systemd-inhibit --what=${what} --why="Pi keep-awake" --mode=block sh -c 'while kill -0 ${opts.piPid} 2>/dev/null; do sleep 5; done'`;
		}
		case "win32": {
			const script = powershellScript(opts.keepDisplay, opts.piPid);
			return `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand ${encodePowerShell(script)}`;
		}
		default:
			return undefined;
	}
}
