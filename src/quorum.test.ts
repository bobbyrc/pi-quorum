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

test("reports malformed JSON distinctly from a missing JSON object", () => {
  assert.throws(
    () =>
      parseMemberReport(
        "provider/model",
        '{"recommendation":"A","rationale":"because",}',
      ),
    /contained invalid JSON/,
  );
});

test("rejects an incomplete member report instead of treating it as an abstention", () => {
  assert.throws(
    () => parseMemberReport("provider/model", "{}"),
    /recommendation must be a non-empty string/,
  );
});

test("validates structured member fields at the trust boundary", () => {
  const base = { recommendation: "Choose A", rationale: "Safer" };
  assert.throws(
    () =>
      parseMemberReport(
        "provider/model",
        JSON.stringify({ ...base, options: "not-an-array" }),
      ),
    /options must be an array/,
  );
  assert.throws(
    () =>
      parseMemberReport(
        "provider/model",
        JSON.stringify({ ...base, confidence: "certain" }),
      ),
    /confidence must be high, medium, or low/,
  );
  assert.throws(
    () =>
      parseMemberReport(
        "provider/model",
        JSON.stringify({ ...base, risks: ["valid", 42] }),
      ),
    /risks must be an array of strings/,
  );
  assert.throws(
    () =>
      parseMemberReport(
        "provider/model",
        JSON.stringify({ ...base, options: ["invalid"] }),
      ),
    /Option 1 must be an object/,
  );
});

test("normalizes optional fields and bounds model-supplied collections", () => {
  const parsed = parseMemberReport(
    "provider/model",
    JSON.stringify({
      recommendation: "  Choose A  ",
      rationale: "  Safer  ",
      risks: [" one ", "", "two", "three", "four", "five", "six", "seven"],
      options: [
        {},
        { title: "  Defaulted option  " },
        { title: "Second" },
        { title: "Third" },
        { title: "Ignored fifth option" },
      ],
    }),
  );
  assert.equal(parsed.recommendation, "Choose A");
  assert.equal(parsed.rationale, "Safer");
  assert.equal(parsed.confidence, "medium");
  assert.deepEqual(parsed.risks, [
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
  ]);
  assert.deepEqual(
    parsed.options.map(({ id, title, rationale }) => ({ id, title, rationale })),
    [
      { id: "option-2", title: "Defaulted option", rationale: "" },
      { id: "option-3", title: "Second", rationale: "" },
      { id: "option-4", title: "Third", rationale: "" },
    ],
  );
});

test("requires at least two reports and recognizes clean consensus", () => {
  assert.throws(
    () => synthesizeDecision(request, [report("one/model", "Choose A")]),
    /at least two member reports/,
  );
  const result = synthesizeDecision(request, [
    report("one/model", "Choose A"),
    report("two/model", "choose-a"),
  ]);
  assert.equal(result.outcome, "consensus");
  assert.equal(result.recommendation, "Choose A");
});

test("deduplicates equivalent option titles across reports", () => {
  const first = report("one/model", "Choose A");
  const second = report("two/model", "Choose A");
  first.options = [option("sqlite", "Use SQLite")];
  second.options = [option("sqlite-alt", " use sqlite ")];
  assert.deepEqual(
    synthesizeDecision(request, [first, second]).options.map((item) => item.id),
    ["sqlite"],
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

test("includes permitted session evidence and peer critique in later rounds", async () => {
  const prompts: string[] = [];
  let calls = 0;
  const result = await deliberate(
    {} as ExtensionContext,
    {
      members: [{ modelKey: "one/model" }, { modelKey: "two/model" }],
      contextMode: "session-summary",
      maxRounds: 2,
      review: { enabled: false, maxRounds: 1, autoPromptFixes: true },
    },
    { ...request, context: "Decision context" },
    undefined,
    {
      askMember: async (_ctx, member, prompt) => {
        calls += 1;
        prompts.push(prompt);
        const recommendation =
          calls <= 2 && member.modelKey === "two/model"
            ? "Choose B"
            : "Choose A";
        return JSON.stringify({ recommendation, rationale: "Because" });
      },
      summarizeSession: () => "Bounded session evidence",
    },
  );
  assert.equal(result.outcome, "consensus");
  assert.equal(calls, 4);
  assert.match(prompts[0], /Decision context/);
  assert.match(prompts[0], /Bounded session evidence/);
  assert.doesNotMatch(prompts[0], /Other advisors' reports/);
  assert.match(prompts[2], /Other advisors' reports/);
});

test("does not start a round when the signal is already aborted", async () => {
  let calls = 0;
  await assert.rejects(
    deliberate(
      {} as ExtensionContext,
      {
        members: [{ modelKey: "one/model" }, { modelKey: "two/model" }],
        contextMode: "fresh",
        maxRounds: 2,
        review: { enabled: false, maxRounds: 1, autoPromptFixes: true },
      },
      request,
      AbortSignal.abort(),
      {
        askMember: async () => {
          calls += 1;
          throw new Error("must not run");
        },
        summarizeSession: () => "",
      },
    ),
    { name: "AbortError" },
  );
  assert.equal(calls, 0);
});

test("does not launch another round after cancellation", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    deliberate(
      {} as ExtensionContext,
      {
        members: [{ modelKey: "one/model" }, { modelKey: "two/model" }],
        contextMode: "fresh",
        maxRounds: 3,
        review: { enabled: false, maxRounds: 1, autoPromptFixes: true },
      },
      request,
      controller.signal,
      {
        askMember: async (_ctx, member) => {
          calls += 1;
          if (calls === 2) controller.abort();
          const recommendation =
            member.modelKey === "one/model" ? "Choose A" : "Choose B";
          return JSON.stringify({
            recommendation,
            rationale: `${recommendation} rationale`,
          });
        },
        summarizeSession: () => "",
      },
    ),
    { name: "AbortError" },
  );
  assert.equal(calls, 2);
});
