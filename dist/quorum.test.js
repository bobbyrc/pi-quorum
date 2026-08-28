import assert from "node:assert/strict";
import test from "node:test";
import { parseMemberReport } from "./quorum.js";
test("parses a fenced member report into actionable options", () => {
    const report = parseMemberReport("provider/model", '```json\n{"recommendation":"choose A","rationale":"safer","risks":["cost"],"confidence":"high","options":[{"id":"a","title":"A","rationale":"good","tradeoffs":["slower"],"risks":[],"implementationNotes":["precondition"]}]}\n```');
    assert.equal(report.recommendation, "choose A");
    assert.equal(report.options[0]?.id, "a");
    assert.deepEqual(report.options[0]?.implementationNotes, ["precondition"]);
});
test("rejects non-object member JSON", () => {
    assert.throws(() => parseMemberReport("provider/model", "[1, 2]"), /did not contain JSON|invalid JSON|must be an object/);
});
