import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { askReadOnlyMember, sessionSummary } from "./runner.js";
import type { DecisionRequest, DecisionResult, MemberReport, QuorumConfig } from "./types.js";
export declare function parseMemberReport(member: string, raw: string): MemberReport;
export declare function synthesizeDecision(request: DecisionRequest, reports: MemberReport[]): DecisionResult;
export interface DeliberationDependencies {
    askMember: typeof askReadOnlyMember;
    summarizeSession: typeof sessionSummary;
}
export declare function deliberate(ctx: ExtensionContext, config: QuorumConfig, request: DecisionRequest, signal?: AbortSignal, dependencies?: DeliberationDependencies): Promise<DecisionResult>;
