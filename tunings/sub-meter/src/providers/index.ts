import type { UsageAdapter } from "../types.ts";
import { codexAdapter } from "./codex.ts";
import { openCodeGoAdapter } from "./opencode-go.ts";

const adapters: UsageAdapter[] = [codexAdapter, openCodeGoAdapter];

export function adapterFor(provider: string | undefined): UsageAdapter | undefined {
	return adapters.find((adapter) => adapter.provider === provider);
}
