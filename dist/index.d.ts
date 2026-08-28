import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { deliberate } from "./quorum.js";
import { collectGitChanges, splitDiffForReview } from "./review.js";
import type { QuorumConfig } from "./types.js";
export interface QuorumExtensionDependencies {
    deliberateDecision: typeof deliberate;
    collectChanges: typeof collectGitChanges;
    splitDiff: typeof splitDiffForReview;
    now: () => number;
    reviewTimeoutMs: number;
    reviewFailureRetryMs: number;
}
export declare function chooseConfig(ctx: ExtensionContext): Promise<QuorumConfig | undefined>;
export default function quorumExtension(pi: ExtensionAPI, dependencies?: QuorumExtensionDependencies): void;
