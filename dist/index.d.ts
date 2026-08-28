import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { QuorumConfig } from "./types.js";
export declare function chooseConfig(ctx: ExtensionContext): Promise<QuorumConfig | undefined>;
export default function quorumExtension(pi: ExtensionAPI): void;
