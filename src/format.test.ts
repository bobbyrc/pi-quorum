import assert from "node:assert/strict";
import test from "node:test";
import { formatDecisionResult, formatReviewResults } from "./format.js";
import type { DecisionResult, MemberReport } from "./types.js";

function report(member: string, recommendation: string): MemberReport {
  return {
    member,
    recommendation,
    rationale: "Concrete rationale",
    risks: ["Regression risk"],
    dissent: [],
    confidence: "high",
    options: [],
  };
}

function unresolvedResult(): DecisionResult {
  return {
    request: { id: "storage", question: "Choose storage" },
    outcome: "unresolved",
    recommendation: "No material quorum was reached.",
    rationale: "The members disagree.",
    options: [
      {
        id: "sqlite",
        title: "Use SQLite",
        rationale: "It is local and durable.",
        tradeoffs: ["Single writer"],
        risks: ["Lock contention"],
        implementationNotes: ["Enable WAL"],
      },
    ],
    reports: [report("one/model", "Use SQLite"), report("two/model", "Use Postgres")],
  };
}

test("puts every unresolved option detail in model-visible content", () => {
  const text = formatDecisionResult(unresolvedResult());
  assert.match(text, /sqlite: Use SQLite/);
  assert.match(text, /Single writer/);
  assert.match(text, /Lock contention/);
  assert.match(text, /Enable WAL/);
});

test("puts the full selected option in model-visible content", () => {
  const result = unresolvedResult();
  result.selectedOptionId = "sqlite";
  const text = formatDecisionResult(result);
  assert.match(text, /Selected direction:/);
  assert.match(text, /It is local and durable/);
});

test("puts each reviewer's actionable report in follow-up content", () => {
  const result = unresolvedResult();
  const text = formatReviewResults([result]);
  assert.match(text, /one\/model.*Use SQLite/);
  assert.match(text, /two\/model.*Use Postgres/);
  assert.match(text, /Regression risk/);
});
