import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { collectGitChanges, splitDiffForReview } from "./review.js";
function run(cwd, command, args) {
    const result = spawnSync(command, args, { cwd, encoding: "utf8" });
    return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        code: result.status ?? 1,
        killed: result.signal !== null,
    };
}
function git(cwd, args) {
    const result = run(cwd, "git", args);
    assert.equal(result.code, 0, result.stderr);
}
test("collects staged tracked changes and untracked files", async (t) => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-quorum-review-test-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    git(cwd, ["init", "--quiet"]);
    await writeFile(join(cwd, "tracked.txt"), "base\n");
    git(cwd, ["add", "tracked.txt"]);
    git(cwd, [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "base",
    ]);
    await writeFile(join(cwd, "tracked.txt"), "staged content\n");
    git(cwd, ["add", "tracked.txt"]);
    await writeFile(join(cwd, "untracked.txt"), "untracked content\n");
    await writeFile(join(cwd, "empty-untracked.txt"), "");
    const changes = await collectGitChanges({
        exec: async (command, args) => run(cwd, command, args),
    });
    assert.match(changes.patch, /staged content/);
    assert.match(changes.patch, /untracked\.txt/);
    assert.match(changes.patch, /untracked content/);
    assert.match(changes.patch, /empty-untracked\.txt/);
    assert.match(changes.fingerprint, /^[a-f0-9]{64}$/);
});
test("chunks a large diff without omitting any content", () => {
    const patch = `${"a".repeat(19)}\n${"b".repeat(19)}\n${"c".repeat(19)}`;
    const parts = splitDiffForReview(patch, 20);
    assert.ok(parts.length > 1);
    assert.equal(parts.join(""), patch);
    assert.ok(parts.every((part) => part.length <= 20));
});
