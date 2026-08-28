import { createHash } from "node:crypto";
async function requiredGitDiff(pi, args) {
    const result = await pi.exec("git", args, {});
    if (result.code !== 0)
        throw new Error(`Unable to collect Git changes: ${result.stderr.trim() || `git exited with code ${result.code}`}`);
    return result.stdout;
}
async function trackedPatch(pi) {
    const head = await pi.exec("git", ["rev-parse", "--verify", "HEAD"], {});
    if (head.code === 0)
        return requiredGitDiff(pi, [
            "diff",
            "--no-ext-diff",
            "--unified=3",
            "HEAD",
            "--",
        ]);
    const [staged, unstaged] = await Promise.all([
        requiredGitDiff(pi, [
            "diff",
            "--cached",
            "--no-ext-diff",
            "--unified=3",
            "--",
        ]),
        requiredGitDiff(pi, ["diff", "--no-ext-diff", "--unified=3", "--"]),
    ]);
    return `${staged}${unstaged}`;
}
async function untrackedPatch(pi) {
    const result = await pi.exec("git", ["ls-files", "--others", "--exclude-standard", "-z"], {});
    if (result.code !== 0)
        throw new Error(`Unable to list untracked files: ${result.stderr.trim() || `git exited with code ${result.code}`}`);
    const paths = result.stdout.split("\0").filter(Boolean);
    const patches = [];
    for (const path of paths) {
        const diff = await pi.exec("git", [
            "diff",
            "--no-index",
            "--no-ext-diff",
            "--unified=3",
            "--",
            "/dev/null",
            path,
        ], {});
        if (diff.code !== 0 && diff.code !== 1)
            throw new Error(`Unable to read untracked change ${JSON.stringify(path)}: ${diff.stderr.trim() || `git exited with code ${diff.code}`}`);
        patches.push(diff.stdout ||
            `Untracked empty file: ${JSON.stringify(path)}\n`);
    }
    return patches.join("");
}
export async function collectGitChanges(pi) {
    const [tracked, untracked] = await Promise.all([
        trackedPatch(pi),
        untrackedPatch(pi),
    ]);
    const patch = `${tracked}${untracked}`;
    return {
        patch,
        fingerprint: createHash("sha256").update(patch).digest("hex"),
    };
}
export function splitDiffForReview(patch, maxChars = 20_000) {
    if (!Number.isInteger(maxChars) || maxChars < 1)
        throw new Error("Review chunk size must be a positive integer");
    const chunks = [];
    let start = 0;
    while (start < patch.length) {
        let end = Math.min(start + maxChars, patch.length);
        if (end < patch.length) {
            const newline = patch.lastIndexOf("\n", end - 1);
            if (newline >= start)
                end = newline + 1;
        }
        if (end === start)
            end = Math.min(start + maxChars, patch.length);
        chunks.push(patch.slice(start, end));
        start = end;
    }
    return chunks;
}
