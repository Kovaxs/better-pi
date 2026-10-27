import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DisplayMode, Settings } from "./types.ts";

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
	display: "rotate",
	rotateSeconds: 8,
	refreshSeconds: 60,
	warnAt: 75,
	dangerAt: 90,
});

const displays = new Set<DisplayMode>(["rotate", "both", "session", "week"]);

function numberOr(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function validateSettings(value: unknown): Settings {
	if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_SETTINGS };
	const input = value as Record<string, unknown>;
	const display = typeof input.display === "string" && displays.has(input.display as DisplayMode)
		? input.display as DisplayMode
		: DEFAULT_SETTINGS.display;
	const rotate = numberOr(input.rotateSeconds, DEFAULT_SETTINGS.rotateSeconds);
	return {
		display,
		rotateSeconds: rotate > 0 ? rotate : DEFAULT_SETTINGS.rotateSeconds,
		refreshSeconds: Math.max(30, numberOr(input.refreshSeconds, DEFAULT_SETTINGS.refreshSeconds)),
		warnAt: numberOr(input.warnAt, DEFAULT_SETTINGS.warnAt),
		dangerAt: numberOr(input.dangerAt, DEFAULT_SETTINGS.dangerAt),
	};
}

export async function loadSettings(path: string): Promise<Settings> {
	try {
		return validateSettings(JSON.parse(await readFile(path, "utf8")));
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export async function saveSettings(path: string, settings: Settings): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(validateSettings(settings), null, 2)}\n`, "utf8");
}
