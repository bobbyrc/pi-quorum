import { Type } from "typebox";
import { loadConfig, saveConfig } from "./config.js";
import { formatDecisionResult, formatReviewResults } from "./format.js";
import { deliberate } from "./quorum.js";
import { collectGitChanges, splitDiffForReview } from "./review.js";
const POLICY = `## Quorum policy\nUse quorum for material architecture, API, security, reliability, cost, data, dependency, and irreversible decisions. Batch related decisions in one quorum call. Quorum members are advisory-only and never perform implementation work. For unresolved outcomes, use the returned selectable options and wait for the user's choice before continuing.`;
const REVIEW_TIMEOUT_MS = 10 * 60_000;
const REVIEW_FAILURE_RETRY_MS = 5 * 60_000;
const REVIEW_STATUS_KEY = "pi-quorum-review";
const DecisionSchema = Type.Object({
    id: Type.String({
        description: "Stable identifier for this decision in a batch",
    }),
    question: Type.String({
        description: "The decision or question to deliberate",
    }),
    context: Type.Optional(Type.String({
        description: "Decision-specific evidence; omit to keep the quorum fresh",
    })),
});
const QuorumSchema = Type.Object({
    decisions: Type.Array(DecisionSchema, {
        minItems: 1,
        maxItems: 8,
        description: "One or more related decisions to deliberate as a batch",
    }),
});
function configStatus(config) {
    const members = config.members.length
        ? config.members.map((member) => member.modelKey).join(", ")
        : "none";
    return `Members: ${members}\nContext: ${config.contextMode}\nDecision rounds: ${config.maxRounds}\nReview: ${config.review.enabled ? `on (${config.review.maxRounds} round${config.review.maxRounds === 1 ? "" : "s"})` : "off"}`;
}
export async function chooseConfig(ctx) {
    const available = (ctx.scopedModels.length
        ? ctx.scopedModels.map((item) => item.model)
        : ctx.modelRegistry.getAvailable())
        .map((model) => `${model.provider}/${model.id}`)
        .sort();
    if (available.length < 2) {
        ctx.ui.notify("Quorum requires at least two authenticated models.", "error");
        return undefined;
    }
    const members = [];
    while (members.length < 4) {
        const choices = [
            ...available.filter((key) => !members.some((member) => member.modelKey === key)),
            "Done",
        ];
        const selected = await ctx.ui.select(`Quorum member ${members.length + 1} (minimum 2):`, choices);
        if (!selected || selected === "Done")
            break;
        members.push({ modelKey: selected, thinking: "high" });
    }
    if (members.length < 2) {
        ctx.ui.notify("Configuration cancelled: choose at least two members.", "warning");
        return undefined;
    }
    const contextChoice = await ctx.ui.select("What may members see?", [
        "Fresh request only",
        "Bounded session summary",
    ]);
    if (!contextChoice)
        return undefined;
    const roundsChoice = await ctx.ui.select("Maximum decision rounds:", [
        "1",
        "2",
        "3",
    ]);
    if (!roundsChoice)
        return undefined;
    const reviewChoice = await ctx.ui.select("Automatic final review:", [
        "Off",
        "On — prompt the main agent to address findings",
    ]);
    if (!reviewChoice)
        return undefined;
    const reviewRounds = reviewChoice?.startsWith("On")
        ? await ctx.ui.select("Maximum review rounds:", ["1", "2", "3"])
        : "1";
    if (!reviewRounds)
        return undefined;
    return {
        members,
        contextMode: contextChoice === "Bounded session summary" ? "session-summary" : "fresh",
        maxRounds: Number(roundsChoice ?? "2"),
        review: {
            enabled: reviewChoice?.startsWith("On") ?? false,
            maxRounds: Number(reviewRounds ?? "1"),
            autoPromptFixes: true,
        },
    };
}
async function selectUnresolved(ctx, result) {
    if (result.outcome !== "unresolved" ||
        result.options.length === 0 ||
        !ctx.hasUI)
        return result;
    const labels = result.options.map((option) => `${option.title} — ${option.rationale}`);
    const selected = await ctx.ui.select(`No quorum: ${result.request.question}`, labels);
    const index = selected ? labels.indexOf(selected) : -1;
    if (index >= 0)
        result.selectedOptionId = result.options[index].id;
    return result;
}
export default function quorumExtension(pi) {
    let reviewInFlight = false;
    let automaticFixPending = false;
    let lastReviewedFingerprint = "";
    let activeReviewController;
    let warnedInvalidReviewConfig = false;
    let failedReview;
    const abortActiveReview = (message) => {
        activeReviewController?.abort(new DOMException(message, "AbortError"));
    };
    pi.on("session_shutdown", () => abortActiveReview("Session shut down"));
    pi.on("session_before_switch", () => abortActiveReview("Session switched"));
    pi.on("session_before_fork", () => abortActiveReview("Session forked"));
    pi.on("before_agent_start", (event) => ({
        systemPrompt: `${event.systemPrompt}\n\n${POLICY}`,
    }));
    pi.registerTool({
        name: "quorum",
        label: "Quorum",
        description: "Reach a bounded, read-only multi-model decision quorum. Send all known related decisions in one batch.",
        promptSnippet: "Deliberate material decisions with user-configured, read-only quorum members",
        promptGuidelines: [
            "Use quorum for material decisions and batch related decisions in one call. Never ask quorum members to implement or modify files.",
        ],
        parameters: QuorumSchema,
        executionMode: "sequential",
        async execute(_id, params, signal, _update, ctx) {
            const config = await loadConfig();
            if (config.members.length < 2)
                throw new Error("Quorum is not configured. Ask the user to run /quorum configure.");
            const results = [];
            for (const request of params.decisions) {
                signal?.throwIfAborted();
                results.push(await selectUnresolved(ctx, await deliberate(ctx, config, request, signal)));
            }
            return {
                content: [
                    {
                        type: "text",
                        text: results
                            .map(formatDecisionResult)
                            .join("\n\n"),
                    },
                ],
                details: { results },
            };
        },
    });
    pi.registerCommand("quorum", {
        description: "Configure or inspect pi-quorum (/quorum configure | status)",
        handler: async (args, ctx) => {
            if (args.trim() === "configure") {
                const config = await chooseConfig(ctx);
                if (config) {
                    await saveConfig(config);
                    ctx.ui.notify(`Quorum configured. ${configStatus(config)}`, "info");
                }
                return;
            }
            ctx.ui.notify(configStatus(await loadConfig()), "info");
        },
    });
    pi.on("agent_settled", async (_event, ctx) => {
        const config = await loadConfig();
        if (!config.review.enabled || reviewInFlight)
            return;
        if (config.members.length < 2) {
            if (!warnedInvalidReviewConfig) {
                ctx.ui.notify("Automatic quorum review is disabled until at least two valid members are configured with /quorum configure.", "error");
                warnedInvalidReviewConfig = true;
            }
            return;
        }
        warnedInvalidReviewConfig = false;
        if (automaticFixPending) {
            automaticFixPending = false;
            lastReviewedFingerprint = (await collectGitChanges(pi)).fingerprint;
            return;
        }
        const changes = await collectGitChanges(pi);
        if (!changes.patch || changes.fingerprint === lastReviewedFingerprint)
            return;
        if (failedReview?.fingerprint === changes.fingerprint &&
            Date.now() < failedReview.retryAfter)
            return;
        reviewInFlight = true;
        const reviewController = new AbortController();
        let reviewTimedOut = false;
        const canCancelInteractively = ctx.mode === "tui";
        activeReviewController = reviewController;
        const timeout = setTimeout(() => {
            reviewTimedOut = true;
            reviewController.abort(new DOMException("Automatic quorum review timed out", "AbortError"));
        }, REVIEW_TIMEOUT_MS);
        const stopListening = canCancelInteractively
            ? ctx.ui.onTerminalInput((data) => {
                if (data !== "\u0003")
                    return undefined;
                reviewController.abort(new DOMException("Automatic quorum review cancelled", "AbortError"));
                return { consume: true };
            })
            : () => undefined;
        ctx.ui.setStatus(REVIEW_STATUS_KEY, canCancelInteractively
            ? "reviewing changes (Ctrl-C to cancel)"
            : "reviewing changes");
        ctx.ui.notify(canCancelInteractively
            ? "Automatic quorum review started. Press Ctrl-C to cancel."
            : "Automatic quorum review started.", "info");
        try {
            const parts = splitDiffForReview(changes.patch);
            const results = [];
            for (const [index, part] of parts.entries()) {
                reviewController.signal.throwIfAborted();
                ctx.ui.setStatus(REVIEW_STATUS_KEY, `reviewing changes ${index + 1}/${parts.length}${canCancelInteractively ? " (Ctrl-C to cancel)" : ""}`);
                results.push(await deliberate(ctx, { ...config, maxRounds: config.review.maxRounds }, {
                    id: `final-code-review-${index + 1}`,
                    question: `Review diff part ${index + 1} of ${parts.length} for correctness, regressions, security, and missing tests. Return only actionable findings ranked by severity; do not modify anything. If there are no findings, say so explicitly.`,
                    context: part,
                }, reviewController.signal));
            }
            lastReviewedFingerprint = changes.fingerprint;
            failedReview = undefined;
            automaticFixPending = config.review.autoPromptFixes;
            pi.sendMessage({
                customType: "pi-quorum-review",
                content: formatReviewResults(results),
                display: true,
                details: {
                    results,
                    fingerprint: changes.fingerprint,
                    provenance: "pi-quorum-auto-review",
                },
            }, { triggerTurn: config.review.autoPromptFixes, deliverAs: "followUp" });
        }
        catch (error) {
            if (reviewController.signal.aborted) {
                if (reviewTimedOut) {
                    failedReview = {
                        fingerprint: changes.fingerprint,
                        retryAfter: Date.now() + REVIEW_FAILURE_RETRY_MS,
                    };
                }
                else {
                    lastReviewedFingerprint = changes.fingerprint;
                }
                const reason = reviewController.signal.reason;
                ctx.ui.notify(reason instanceof Error
                    ? reason.message
                    : reviewTimedOut
                        ? "Automatic quorum review timed out."
                        : "Automatic quorum review cancelled.", "warning");
                return;
            }
            failedReview = {
                fingerprint: changes.fingerprint,
                retryAfter: Date.now() + REVIEW_FAILURE_RETRY_MS,
            };
            ctx.ui.notify("Automatic quorum review failed. The same change set will not be retried for five minutes.", "error");
            throw error;
        }
        finally {
            clearTimeout(timeout);
            stopListening();
            ctx.ui.setStatus(REVIEW_STATUS_KEY, undefined);
            if (activeReviewController === reviewController)
                activeReviewController = undefined;
            reviewInFlight = false;
        }
    });
}
