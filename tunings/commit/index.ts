import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommit } from "./command.ts";

export default function (pi: ExtensionAPI) {
	registerCommit(pi, join(getAgentDir(), "commit", "settings.json"));
}
