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

function strings(value: string[] | undefined): string[] {
  return (value ?? []).slice(0, 6);
}

export function parseMemberReport(member: string, raw: string): MemberReport {
  const value = jsonFrom(raw);
  const options = (value.options ?? []).slice(0, 4).flatMap((option, index) => {
    if (!option.title) return [];
    return [
      {
        id: option.id ?? `option-${index + 1}`,
        title: option.title,
        rationale: option.rationale ?? "",
        tradeoffs: strings(option.tradeoffs),
        risks: strings(option.risks),
        implementationNotes: strings(option.implementationNotes),
      } satisfies DeliberationOption,
    ];
  });
  return {
    member,
    recommendation: value.recommendation ?? "",
    rationale: value.rationale ?? "",
    risks: strings(value.risks),
    options,
    confidence: value.confidence ?? "medium",
  };
}

function promptFor(
  request: DecisionRequest,
  evidence: string,
  peerReports?: MemberReport[],
): string {
  return `Evaluate this decision independently. You are advisory only; do not make changes and do not provide step-by-step implementation instructions.\n\nDecision: ${request.question}\n${request.context ? `\nDecision-specific context:\n${request.context}\n` : ""}${evidence ? `\nContext permitted by the caller:\n${evidence}\n` : ""}${peerReports ? `\nAnother advisor's reports require critique, not deference:\n${JSON.stringify(peerReports)}\n` : ""}\nReturn JSON only: {"recommendation":"short direction","rationale":"why","risks":["..."],"confidence":"high|medium|low","options":[{"id":"stable-id","title":"short title","rationale":"what it entails","tradeoffs":["..."],"risks":["..."],"implementationNotes":["ready-to-act constraint or prerequisite"]}]}. Include 2-4 genuinely viable options whenever the direction is not clearly unanimous.`;
}

function uniqueOptions(reports: MemberReport[]): DeliberationOption[] {
  const seen = new Set<string>();
  return reports
    .flatMap((report) => report.options)
    .filter((option) => {
      const key = option.title.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function deliberate(
  ctx: ExtensionContext,
  config: QuorumConfig,
  request: DecisionRequest,
  signal?: AbortSignal,
): Promise<DecisionResult> {
  if (config.members.length < 2)
    throw new Error(
      "Configure at least two quorum members with /quorum configure.",
    );
  const evidence =
    config.contextMode === "session-summary" ? sessionSummary(ctx) : "";
  let reports = await Promise.all(
    config.members.map(async (member) =>
      parseMemberReport(
        member.modelKey,
        await askReadOnlyMember(
          ctx,
          member,
          promptFor(request, evidence),
          signal,
        ),
      ),
    ),
  );
  const firstChoices = new Set(
    reports.map((report) => normalized(report.recommendation)).filter(Boolean),
  );
  if (firstChoices.size > 1 && config.maxRounds > 1) {
    reports = await Promise.all(
      config.members.map(async (member) =>
        parseMemberReport(
          member.modelKey,
          await askReadOnlyMember(
            ctx,
            member,
            promptFor(request, evidence, reports),
            signal,
          ),
        ),
      ),
    );
  }
  const choices = new Set(
    reports.map((report) => normalized(report.recommendation)).filter(Boolean),
  );
  const outcome = choices.size === 1 ? "consensus" : "unresolved";
  const options = uniqueOptions(reports);
  return {
    request,
    outcome,
    recommendation:
      outcome === "consensus"
        ? (reports[0]?.recommendation ?? "")
        : "No material quorum was reached.",
    rationale:
      outcome === "consensus"
        ? reports
            .map((report) => report.rationale)
            .filter(Boolean)
            .join("\n\n")
        : "The members materially disagree or could not provide a common direction.",
    options,
    reports,
  };
}
