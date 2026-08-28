import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
type GitExecutor = Pick<ExtensionAPI, "exec">;
export interface GitChangeSet {
    patch: string;
    fingerprint: string;
}
export declare function collectGitChanges(pi: GitExecutor): Promise<GitChangeSet>;
export declare function splitDiffForReview(patch: string, maxChars?: number): string[];
export {};
