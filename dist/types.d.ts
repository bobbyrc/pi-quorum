export type ContextMode = "fresh" | "session-summary";
export interface MemberConfig {
    modelKey: string;
    thinking?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}
export interface QuorumConfig {
    members: MemberConfig[];
    contextMode: ContextMode;
    maxRounds: number;
    review: {
        enabled: boolean;
        maxRounds: number;
        autoPromptFixes: boolean;
    };
}
export interface DecisionRequest {
    id: string;
    question: string;
    context?: string;
}
export interface DeliberationOption {
    id: string;
    title: string;
    rationale: string;
    tradeoffs: string[];
    risks: string[];
    implementationNotes: string[];
}
export interface MemberReport {
    member: string;
    recommendation: string;
    rationale: string;
    risks: string[];
    options: DeliberationOption[];
    confidence: "high" | "medium" | "low";
}
export type Outcome = "consensus" | "qualified-consensus-with-dissent" | "unresolved";
export interface DecisionResult {
    request: DecisionRequest;
    outcome: Outcome;
    recommendation: string;
    rationale: string;
    options: DeliberationOption[];
    reports: MemberReport[];
    selectedOptionId?: string;
}
export declare const DEFAULT_CONFIG: QuorumConfig;
