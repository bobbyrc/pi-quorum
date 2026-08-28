import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  deliberate,
  parseMemberReport,
  synthesizeDecision,
} from "./quorum.js";
import type {
  DecisionRequest,
  MemberReport,
  QuorumConfig,
} from "./types.js";

const request: DecisionRequest = {
  id: "storage",
  question: "Choose storage",
};

function report(
  member: string,
  recommendation: string,
  dissent: string[] = [],
): MemberReport {
  return {
    member,
    recommendation,
    rationale: `${recommendation} rationale`,
    risks: [],
    dissent,
    confidence: "high",
    options: [],
  };
}

function option(id: string, title: string) {
  return {
    id,
    title,
    rationale: `${title} rationale`,
    tradeoffs: [],
    risks: [],
    implementationNotes: [],
  };
}

test("parses a fenced member report into actionable options", () => {
  const report = parseMemberReport(
    "provider/model",
    '```json\n{"recommendation":"choose A","rationale":"safer","risks":["cost"],"dissent":[],"confidence":"high","options":[{"id":"a","title":"A","rationale":"good","tradeoffs":["slower"],"risks":[],"implementationNotes":["precondition"]}]}\n```',
  );
  assert.equal(report.recommendation, "choose A");
  assert.equal(report.options[0]?.id, "a");
  assert.deepEqual(report.options[0]?.implementationNotes, ["precondition"]);
});

test("rejects non-object member JSON", () => {
  assert.throws(
    () => parseMemberReport("provider/model", "[1, 2]"),
    /did not contain JSON|invalid JSON|must be an object/,
  );
});

test("rejects an incomplete member report instead of treating it as an abstention", () => {
  assert.throws(
    () => parseMemberReport("provider/model", "{}"),
    /recommendation must be a non-empty string/,
  );
});

test("returns qualified consensus when an agreeing member retains dissent", () => {
  const result = synthesizeDecision(request, [
    report("one/model", "Choose A"),
    report("two/model", "choose-a", ["Migration remains risky"]),
  ]);
  assert.equal(result.outcome, "qualified-consensus-with-dissent");
  assert.match(result.rationale, /Migration remains risky/);
});

test("makes option ids unique across member reports", () => {
  const first = report("one/model", "Choose A");
  const second = report("two/model", "Choose B");
  first.options = [option("option-1", "Use SQLite")];
  second.options = [option("option-1", "Use Postgres")];
  const result = synthesizeDecision(request, [first, second]);
  assert.deepEqual(
    result.options.map((item) => item.id),
    ["option-1", "option-1-2"],
  );
});

test("honors a three-round cap while disagreement remains", async () => {
  const config: QuorumConfig = {
    members: [
      { modelKey: "one/model", thinking: "high" },
      { modelKey: "two/model", thinking: "high" },
    ],
    contextMode: "fresh",
    maxRounds: 3,
    review: { enabled: false, maxRounds: 1, autoPromptFixes: true },
  };
  let calls = 0;
  const result = await deliberate(
    {} as ExtensionContext,
    config,
    request,
    undefined,
    {
      askMember: async (_ctx, member) => {
        calls += 1;
        const recommendation =
          member.modelKey === "one/model" ? "Choose A" : "Choose B";
        return JSON.stringify({
          recommendation,
          rationale: `${recommendation} rationale`,
          risks: [],
          dissent: [],
          confidence: "high",
          options: [],
        });
      },
      summarizeSession: () => "",
    },
  );
  assert.equal(calls, 6);
  assert.equal(result.outcome, "unresolved");
});
