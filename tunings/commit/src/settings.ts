import { readFile } from "node:fs/promises";

export const DEFAULT_MODEL = "opencode-go/claude-haiku-5-5";

export async function loadDefaultModel(path: string): Promise<{ provider: string; id: string } | undefined> {
	let json: string;
	try {
		json = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		json = "{}";
	}
	let settings: unknown;
	try {
		settings = JSON.parse(json);
	} catch {
		throw new Error(`Invalid JSON in ${path}.`);
	}
	if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
		throw new Error(`Expected a JSON object in ${path}.`);
	}
	const value = "defaultModel" in settings ? settings.defaultModel : DEFAULT_MODEL;
	if (value === null) return;
	const model = typeof value === "string" ? /^([^/\s]+)\/(\S+)$/.exec(value.trim()) : null;
	if (!model) throw new Error(`Set "defaultModel" in ${path} to "provider/model-id" or null to use the active model.`);
	return { provider: model[1], id: model[2] };
}
