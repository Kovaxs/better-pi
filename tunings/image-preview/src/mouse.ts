interface MouseHost {
	mode: string;
	terminal: { write(data: string): void };
}

export function enableHoverMotion(host: MouseHost, env: Record<string, string | undefined> = process.env): () => void {
	const multiplexed = env.TMUX !== undefined || env.ZELLIJ !== undefined || env.STY !== undefined
		|| /^(tmux|screen)/i.test(env.TERM ?? "");
	if (host.mode !== "fullscreen" || !multiplexed) return () => {};
	// Pi chooses button-motion in multiplexers for performance; passive hover needs all-motion (DECSET 1003).
	host.terminal.write("\x1b[?1003h");
	let enabled = true;
	return () => {
		if (!enabled) return;
		enabled = false;
		host.terminal.write("\x1b[?1003l\x1b[?1002h");
	};
}
