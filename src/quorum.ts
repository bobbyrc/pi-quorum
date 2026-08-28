import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { askReadOnlyMember, sessionSummary } from "./runner.js";
import type {
  DecisionRequest,
  DecisionResult,
  DeliberationOption,
  MemberReport,
  QuorumConfig,
} from "./types.js";

interface RawOption {
  id?: string;
  title?: string;
  rationale?: string;
  tradeoffs?: string[];
  risks?: string[];
  implementationNotes?: string[];
}

interface RawReport {
  recommendation?: string;
  rationale?: string;
  risks?: string[];
  dissent?: string[];
  confidence?: "high" | "medium" | "low";
  options?: RawOption[];
}

function jsonFrom(text: string): RawReport {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end < start)
    throw new Error("Member response did not contain JSON");
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as RawReport;
  } catch (error) {
    throw new Error(
      `Member response contained invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, label);
}

function strings(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`${label} must be an array of strings`);
  return value.map((item) => item.trim()).filter(Boolean).slice(0, 6);
}

export function parseMemberReport(member: string, raw: string): MemberReport {
  const value = record(jsonFrom(raw), "Member report");
  if (value.options !== undefined && !Array.isArray(value.options))
    throw new Error("Member report options must be an array");
  const options = (value.options ?? []).slice(0, 4).flatMap((rawOption, index) => {
    const option = record(rawOption, `Option ${index + 1}`);
    const title = optionalString(option.title, `Option ${index + 1} title`);
    if (!title) return [];
    return [
      {
        id:
          optionalString(option.id, `Option ${index + 1} id`) ??
          `option-${index + 1}`,
        title,
        rationale:
          optionalString(option.rationale, `Option ${index + 1} rationale`) ??
          "",
        tradeoffs: strings(
          option.tradeoffs,
          `Option ${index + 1} tradeoffs`,
        ),
        risks: strings(option.risks, `Option ${index + 1} risks`),
        implementationNotes: strings(
          option.implementationNotes,
          `Option ${index + 1} implementationNotes`,
        ),
      } satisfies DeliberationOption,
    ];
  });
  const confidence = value.confidence ?? "medium";
  if (!(["high", "medium", "low"] as unknown[]).includes(confidence))
    throw new Error("Member report confidence must be high, medium, or low");
  return {
    member,
    recommendation: requiredString(
      value.recommendation,
      "Member report recommendation",
    ),
    rationale: requiredString(value.rationale, "Member report rationale"),
    risks: strings(value.risks, "Member report risks"),
    dissent: strings(value.dissent, "Member report dissent"),
    options,
    confidence: confidence as MemberReport["confidence"],
  };
}

function promptFor(
  request: DecisionRequest,
  evidence: string,
  peerReports?: MemberReport[],
): string {
  return `Evaluate this decision independently. You are advisory only; do not make changes and do not provide step-by-step implementation instructions.\n\nDecision: ${request.question}\n${request.context ? `\nDecision-specific context:\n${request.context}\n` : ""}${evidence ? `\nContext permitted by the caller:\n${evidence}\n` : ""}${peerReports ? `\nOther advisors' reports require critique, not deference:\n${JSON.stringify(peerReports)}\n` : ""}\nReturn JSON only: {"recommendation":"short direction","rationale":"why","risks":["..."],"dissent":["material reservation despite supporting the recommendation"],"confidence":"high|medium|low","options":[{"id":"stable-id","title":"short title","rationale":"what it entails","tradeoffs":["..."],"risks":["..."],"implementationNotes":["ready-to-act constraint or prerequisite"]}]}. recommendation and rationale are required non-empty strings. Use an empty dissent array unless you support the recommendation while retaining a material objection. Include 2-4 genuinely viable options whenever the direction is not clearly unanimous.`;
}

function uniqueOptions(reports: MemberReport[]): DeliberationOption[] {
  const seenTitles = new Set<string>();
  const seenIds = new Set<string>();
  return reports
    .flatMap((report) => report.options)
    .flatMap((option) => {
      const titleKey = option.title.trim().toLowerCase();
      if (!titleKey || seenTitles.has(titleKey)) return [];
      seenTitles.add(titleKey);
      const baseId = option.id;
      let id = baseId;
      let suffix = 2;
      while (seenIds.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
      seenIds.add(id);
      return [{ ...option, id }];
    });
}

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function materiallyDisagree(reports: MemberReport[]): boolean {
  const choices = new Set(
    reports.map((report) => normalized(report.recommendation)),
  );
  return choices.size > 1 || reports.some((report) => report.dissent.length > 0);
}

export function synthesizeDecision(
  request: DecisionRequest,
  reports: MemberReport[],
): DecisionResult {
  if (reports.length < 2)
    throw new Error("A quorum result requires at least two member reports");
  const choices = new Set(
    reports.map((report) => normalized(report.recommendation)),
  );
  const agreed = choices.size === 1;
  const hasDissent = reports.some((report) => report.dissent.length > 0);
  const outcome = agreed
    ? hasDissent
      ? "qualified-consensus-with-dissent"
      : "consensus"
    : "unresolved";
  const rationale = agreed
    ? reports
        .flatMap((report) => [
          report.rationale,
          ...report.dissent.map((item) => `Dissent (${report.member}): ${item}`),
        ])
        .filter(Boolean)
        .join("\n\n")
    : "The members materially disagree or could not provide a common direction.";
  return {
    request,
    outcome,
    recommendation: agreed
      ? reports[0].recommendation
      : "No material quorum was reached.",
    rationale,
    options: uniqueOptions(reports),
    reports,
  };
}

export interface DeliberationDependencies {
  askMember: typeof askReadOnlyMember;
  summarizeSession: typeof sessionSummary;
}

const DEFAULT_DEPENDENCIES: DeliberationDependencies = {
  askMember: askReadOnlyMember,
  summarizeSession: sessionSummary,
};

export async function deliberate(
  ctx: ExtensionContext,
  config: QuorumConfig,
  request: DecisionRequest,
  signal?: AbortSignal,
  dependencies: DeliberationDependencies = DEFAULT_DEPENDENCIES,
): Promise<DecisionResult> {
  if (config.members.length < 2)
    throw new Error(
      "Configure at least two quorum members with /quorum configure.",
    );
  const evidence =
    config.contextMode === "session-summary"
      ? dependencies.summarizeSession(ctx)
      : "";
  const runRound = async (peerReports?: MemberReport[]) =>
    Promise.all(
      config.members.map(async (member) =>
        parseMemberReport(
          member.modelKey,
          await dependencies.askMember(
            ctx,
            member,
            promptFor(request, evidence, peerReports),
            signal,
          ),
        ),
      ),
    );
  let reports = await runRound();
  for (
    let round = 2;
    round <= config.maxRounds && materiallyDisagree(reports);
    round += 1
  ) {
    reports = await runRound(reports);
  }
  return synthesizeDecision(request, reports);
}
