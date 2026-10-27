import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { clampPercent } from "./format.ts";
import type { ProviderId, UsageSnapshot, UsageWindow, WindowKind } from "./types.ts";

type CacheData = Partial<Record<ProviderId, Omit<UsageSnapshot, "provider">>>;
const providers = new Set<ProviderId>(["openai-codex", "opencode-go"]);
const kinds = new Set<WindowKind>(["session", "week", "month"]);

function parseWindow(value: unknown): UsageWindow | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const input = value as Record<string, unknown>;
	if (typeof input.kind !== "string" || !kinds.has(input.kind as WindowKind)) return undefined;
	if (typeof input.percentUsed !== "number" || !Number.isFinite(input.percentUsed)) return undefined;
	const resetsAt = input.resetsAt === undefined ? undefined : input.resetsAt;
	if (resetsAt !== undefined && (typeof resetsAt !== "number" || !Number.isFinite(resetsAt))) return undefined;
	return {
		kind: input.kind as WindowKind,
		percentUsed: clampPercent(input.percentUsed),
		...(resetsAt === undefined ? {} : { resetsAt: resetsAt as number }),
	};
}

function parseSnapshot(provider: ProviderId, value: unknown): UsageSnapshot | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const input = value as Record<string, unknown>;
	if (!Array.isArray(input.windows) || typeof input.measuredAt !== "number" || !Number.isFinite(input.measuredAt)) return undefined;
	const windows = input.windows.map(parseWindow);
	if (windows.some((window) => window === undefined)) return undefined;
	return {
		provider,
		windows: windows as UsageWindow[],
		measuredAt: input.measuredAt,
		...(input.limited === true ? { limited: true } : {}),
	};
}

export function validateCache(value: unknown): CacheData {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const result: CacheData = {};
	for (const [key, snapshot] of Object.entries(value)) {
		if (!providers.has(key as ProviderId)) continue;
		const parsed = parseSnapshot(key as ProviderId, snapshot);
		if (parsed) {
			const { provider: _provider, ...data } = parsed;
			result[key as ProviderId] = data;
		}
	}
	return result;
}

export async function readCache(path: string): Promise<CacheData> {
	try {
		return validateCache(JSON.parse(await readFile(path, "utf8")));
	} catch {
		return {};
	}
}

export async function readCachedSnapshot(path: string, provider: ProviderId): Promise<UsageSnapshot | undefined> {
	const cached = (await readCache(path))[provider];
	return cached ? { provider, ...cached } : undefined;
}

// Rename prevents partial reads; the lock also keeps concurrent read-merge-write cycles newest-wins.
async function acquireCacheLock(path: string): Promise<() => Promise<void>> {
	const lockPath = `${path}.lock`;
	const deadline = Date.now() + 5_000;
	for (;;) {
		try {
			const handle = await open(lockPath, "wx", 0o600);
			return async () => {
				try {
					await handle.close();
				} finally {
					await unlink(lockPath).catch(() => {});
				}
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const metadata = await stat(lockPath).catch(() => undefined);
			if (metadata && Date.now() - metadata.mtimeMs > 10_000) await unlink(lockPath).catch(() => {});
			if (Date.now() >= deadline) throw new Error("Timed out waiting for the usage cache lock");
			await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 30));
		}
	}
}

export async function writeCachedSnapshot(path: string, snapshot: UsageSnapshot): Promise<void> {
	const parsed = parseSnapshot(snapshot.provider, snapshot);
	if (!parsed) throw new Error("Refusing to cache an invalid usage snapshot");
	await mkdir(dirname(path), { recursive: true });
	const release = await acquireCacheLock(path);
	const temporary = join(dirname(path), `.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
	try {
		const cache = await readCache(path);
		const previous = cache[snapshot.provider];
		if (!previous || previous.measuredAt <= snapshot.measuredAt) {
			const { provider: _provider, ...data } = parsed;
			cache[snapshot.provider] = data;
		}
		await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		await rename(temporary, path);
	} finally {
		await unlink(temporary).catch(() => {});
		await release();
	}
}
