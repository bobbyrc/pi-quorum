import assert from "node:assert/strict";
import test from "node:test";
import { askReadOnlyMember, sessionSummary } from "./runner.js";
test("summarizes string-form session message content", () => {
    const ctx = {
        sessionManager: {
            buildContextEntries: () => [
                {
                    type: "message",
                    message: { role: "user", content: "Plain string content" },
                },
            ],
        },
    };
    assert.equal(sessionSummary(ctx), "user: Plain string content");
});
test("rejects an already-aborted member call before creating a session", async () => {
    await assert.rejects(askReadOnlyMember({}, { modelKey: "one/model" }, "prompt", AbortSignal.abort()), { name: "AbortError" });
});
