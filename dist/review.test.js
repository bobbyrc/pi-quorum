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
test("collects staged and unstaged changes in a repository without HEAD", async (t) => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-quorum-unborn-test-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    git(cwd, ["init", "--quiet"]);
    await writeFile(join(cwd, "new.txt"), "staged version\n");
    git(cwd, ["add", "new.txt"]);
    await writeFile(join(cwd, "new.txt"), "unstaged version\n");
    const changes = await collectGitChanges({
        exec: async (command, args) => run(cwd, command, args),
    });
    assert.match(changes.patch, /staged version/);
    assert.match(changes.patch, /unstaged version/);
});
test("reports Git collection failures honestly", async () => {
    const result = (code, stdout = "", stderr = "failure") => ({
        stdout,
        stderr,
        code,
        killed: false,
    });
    await assert.rejects(collectGitChanges({
        exec: async (_command, args) => args[0] === "rev-parse"
            ? result(0, "head\n", "")
            : args[0] === "ls-files"
                ? result(0, "", "")
                : result(2),
    }), /Unable to collect Git changes: failure/);
    await assert.rejects(collectGitChanges({
        exec: async (_command, args) => args[0] === "ls-files"
            ? result(2)
            : args[0] === "rev-parse"
                ? result(0, "head\n", "")
                : result(0, "", ""),
    }), /Unable to list untracked files: failure/);
    await assert.rejects(collectGitChanges({
        exec: async (_command, args) => {
            if (args[0] === "rev-parse")
                return result(0, "head\n", "");
            if (args[0] === "ls-files")
                return result(0, "bad.txt\0", "");
            if (args.includes("--no-index"))
                return result(2);
            return result(0, "", "");
        },
    }), /Unable to read untracked change "bad.txt": failure/);
});
test("chunks a large diff without omitting any content", () => {
    const patch = `${"a".repeat(19)}\n${"b".repeat(19)}\n${"c".repeat(19)}`;
    const parts = splitDiffForReview(patch, 20);
    assert.ok(parts.length > 1);
    assert.equal(parts.join(""), patch);
    assert.ok(parts.every((part) => part.length <= 20));
});
test("validates chunk size and handles an unbroken long line", () => {
    assert.throws(() => splitDiffForReview("diff", 0), /positive integer/);
    assert.deepEqual(splitDiffForReview("x".repeat(25), 10), [
        "x".repeat(10),
        "x".repeat(10),
        "x".repeat(5),
    ]);
    assert.deepEqual(splitDiffForReview(""), []);
});
