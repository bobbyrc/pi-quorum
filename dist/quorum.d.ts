import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DecisionRequest, DecisionResult, MemberReport, QuorumConfig } from "./types.js";
export declare function parseMemberReport(member: string, raw: string): MemberReport;
export declare function deliberate(ctx: ExtensionContext, config: QuorumConfig, request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResult>;
