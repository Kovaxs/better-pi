export function isWezTerm(env: Record<string, string | undefined>, preference = "auto"): boolean {
	return preference === "wezterm" || (preference === "auto"
		&& (env.TERM_PROGRAM?.toLowerCase() === "wezterm" || env.WEZTERM_PANE !== undefined));
}

export function isTmux(env: Record<string, string | undefined>): boolean {
	return env.TMUX !== undefined || /^tmux/i.test(env.TERM ?? "");
}

export function tmuxPassthrough(sequence: string): string {
	return "\x1bPtmux;" + sequence.replaceAll("\x1b", "\x1b\x1b") + "\x1b\\";
}

export function wezTermImageLines(sequence: string, rows: number, tmux: boolean, measure: (text: string) => number): string[] {
	const payload = tmux ? tmuxPassthrough(sequence) : sequence;
	// Older pi ANSI parsers count DCS framing as text. Match their column accounting without altering the payload.
	const transportWidth = measure(payload);
	const accountForTransport = transportWidth > 0 ? `\x1b[${transportWidth}C\x1b[0m` : "";
	// Pair relative cursor controls with SGR: older pi parsers scan CSI through the next supported terminator.
	const up = rows > 1 ? `\x1b[${rows - 1}A\x1b[0m` : "";
	const down = rows > 1 ? `\x1b[${rows - 1}B\x1b[0m` : "";
	return [...Array(Math.max(0, rows - 1)).fill(""), up + payload + down + accountForTransport];
}
