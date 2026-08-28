import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig, saveConfig } from "./config.js";
import { deliberate } from "./quorum.js";
import type { DecisionRequest, DecisionResult, QuorumConfig } from "./types.js";

const POLICY = `## Quorum policy\nUse quorum for material architecture, API, security, reliability, cost, data, dependency, and irreversible decisions. Batch related decisions in one quorum call. Quorum members are advisory-only and never perform implementation work. For unresolved outcomes, use the returned selectable options and wait for the user's choice before continuing.`;

const DecisionSchema = Type.Object({
  id: Type.String({
    description: "Stable identifier for this decision in a batch",
  }),
  question: Type.String({
    description: "The decision or question to deliberate",
  }),
  context: Type.Optional(
    Type.String({
      description: "Decision-specific evidence; omit to keep the quorum fresh",
    }),
  ),
});

const QuorumSchema = Type.Object({
  decisions: Type.Array(DecisionSchema, {
    minItems: 1,
    maxItems: 8,
    description: "One or more related decisions to deliberate as a batch",
  }),
});

function configStatus(config: QuorumConfig): string {
  const members = config.members.length
    ? config.members.map((member) => member.modelKey).join(", ")
    : "none";
  return `Members: ${members}\nContext: ${config.contextMode}\nDecision rounds: ${config.maxRounds}\nReview: ${config.review.enabled ? `on (${config.review.maxRounds} round${config.review.maxRounds === 1 ? "" : "s"})` : "off"}`;
}

async function chooseConfig(
  ctx: ExtensionContext,
): Promise<QuorumConfig | undefined> {
  const available = (
    ctx.scopedModels.length
      ? ctx.scopedModels.map((item) => item.model)
      : ctx.modelRegistry.getAvailable()
  )
    .map((model) => `${model.provider}/${model.id}`)
    .sort();
  if (available.length < 2) {
    ctx.ui.notify(
      "Quorum requires at least two authenticated models.",
      "error",
    );
    return undefined;
  }
  const members: QuorumConfig["members"] = [];
  while (members.length < 4) {
    const choices = [
      ...available.filter(
        (key) => !members.some((member) => member.modelKey === key),
      ),
      "Done",
    ];
    const selected = await ctx.ui.select(
      `Quorum member ${members.length + 1} (minimum 2):`,
      choices,
    );
    if (!selected || selected === "Done") break;
    members.push({ modelKey: selected, thinking: "high" });
  }
  if (members.length < 2) {
    ctx.ui.notify(
      "Configuration cancelled: choose at least two members.",
      "warning",
    );
    return undefined;
  }
  const contextChoice = await ctx.ui.select("What may members see?", [
    "Fresh request only",
    "Bounded session summary",
  ]);
  const roundsChoice = await ctx.ui.select("Maximum decision rounds:", [
    "1",
    "2",
    "3",
  ]);
  const reviewChoice = await ctx.ui.select("Automatic final review:", [
    "Off",
    "On — prompt the main agent to address findings",
  ]);
  const reviewRounds = reviewChoice?.startsWith("On")
    ? await ctx.ui.select("Maximum review rounds:", ["1", "2", "3"])
    : "1";
  return {
    members,
    contextMode:
      contextChoice === "Bounded session summary" ? "session-summary" : "fresh",
    maxRounds: Number(roundsChoice ?? "2"),
    review: {
      enabled: reviewChoice?.startsWith("On") ?? false,
      maxRounds: Number(reviewRounds ?? "1"),
      autoPromptFixes: true,
    },
  };
}

async function selectUnresolved(
  ctx: ExtensionContext,
  result: DecisionResult,
): Promise<DecisionResult> {
  if (
    result.outcome !== "unresolved" ||
    result.options.length === 0 ||
    !ctx.hasUI
  )
    return result;
  const labels = result.options.map(
    (option) => `${option.title} — ${option.rationale}`,
  );
  const selected = await ctx.ui.select(
    `No quorum: ${result.request.question}`,
    labels,
  );
  const index = selected ? labels.indexOf(selected) : -1;
  if (index >= 0) result.selectedOptionId = result.options[index].id;
  return result;
}

async function diffFingerprint(pi: ExtensionAPI): Promise<string> {
  const result = await pi.exec(
    "git",
    ["diff", "--no-ext-diff", "--unified=3"],
    {},
  );
  return result.code === 0 ? result.stdout : "";
}

export default function quorumExtension(pi: ExtensionAPI): void {
  let reviewInFlight = false;
  let automaticFixPending = false;
  let lastReviewedDiff = "";

  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${POLICY}`,
  }));

  pi.registerTool({
    name: "quorum",
    label: "Quorum",
    description:
      "Reach a bounded, read-only multi-model decision quorum. Send all known related decisions in one batch.",
    promptSnippet:
      "Deliberate material decisions with user-configured, read-only quorum members",
    promptGuidelines: [
      "Use quorum for material decisions and batch related decisions in one call. Never ask quorum members to implement or modify files.",
    ],
    parameters: QuorumSchema,
    executionMode: "sequential",
    async execute(_id, params, signal, _update, ctx) {
      const config = await loadConfig();
      if (config.members.length < 2)
        throw new Error(
          "Quorum is not configured. Ask the user to run /quorum configure.",
        );
      const results: DecisionResult[] = [];
      for (const request of params.decisions as DecisionRequest[])
        results.push(
          await selectUnresolved(
            ctx,
            await deliberate(ctx, config, request, signal),
          ),
        );
      return {
        content: [
          {
            type: "text",
            text: results
              .map(
                (result) =>
                  `${result.request.id}: ${result.outcome}\n${result.recommendation}${result.selectedOptionId ? `\nUser selected: ${result.selectedOptionId}` : ""}`,
              )
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
    if (!config.review.enabled || reviewInFlight) return;
    if (automaticFixPending) {
      automaticFixPending = false;
      lastReviewedDiff = await diffFingerprint(pi);
      return;
    }
    const diff = await diffFingerprint(pi);
    if (!diff || diff === lastReviewedDiff) return;
    reviewInFlight = true;
    try {
      const result = await deliberate(
        ctx,
        { ...config, maxRounds: config.review.maxRounds },
        {
          id: "final-code-review",
          question:
            "Review the supplied diff for correctness, regressions, security, and missing tests. Return only actionable findings ranked by severity; do not modify anything.",
          context: diff.slice(0, 24_000),
        },
      );
      lastReviewedDiff = diff;
      automaticFixPending = config.review.autoPromptFixes;
      pi.sendMessage(
        {
          customType: "pi-quorum-review",
          content: `Read-only quorum code review (${result.outcome}):\n${result.recommendation}\n${result.rationale}\n\nAddress every actionable finding now. Do not invoke another review in response to this message.`,
          display: true,
          details: { result, provenance: "pi-quorum-auto-review" },
        },
        { triggerTurn: config.review.autoPromptFixes, deliverAs: "followUp" },
      );
    } finally {
      reviewInFlight = false;
    }
  });
}
