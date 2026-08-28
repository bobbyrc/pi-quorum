import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { QuorumExtensionDependencies } from "./index.js";
import type {
  DecisionRequest,
  DecisionResult,
  MemberReport,
} from "./types.js";

const configRoot = await mkdtemp(join(tmpdir(), "pi-quorum-config-test-"));
process.env.XDG_CONFIG_HOME = configRoot;
const { chooseConfig, default: quorumExtension } = await import("./index.js");
const { loadConfig, saveConfig } = await import("./config.js");

after(() => rm(configRoot, { recursive: true, force: true }));

function wizardContext(selections: Array<string | undefined>): ExtensionContext {
  return {
    scopedModels: [],
    modelRegistry: {
      getAvailable: () => [
        { provider: "one", id: "model" },
        { provider: "two", id: "model" },
      ],
    },
    ui: {
      select: async () => selections.shift(),
      notify: () => undefined,
    },
  } as unknown as ExtensionContext;
}

function report(member = "one/model"): MemberReport {
  return {
    member,
    recommendation: "Choose A",
    rationale: "Because A is safer",
    risks: [],
    dissent: [],
    confidence: "high",
    options: [],
  };
}

function decisionResult(request: DecisionRequest): DecisionResult {
  return {
    request,
    outcome: "consensus",
    recommendation: "Choose A",
    rationale: "Because A is safer",
    options: [],
    reports: [report(), report("two/model")],
  };
}

function extensionHarness(
  overrides: Partial<QuorumExtensionDependencies> = {},
) {
  const handlers = new Map<
    string,
    Array<(event: unknown, ctx: ExtensionContext) => unknown>
  >();
  const messages: Array<{ message: any; options: any }> = [];
  let registeredTool: any;
  let registeredCommand: any;
  const pi = {
    on: (
      event: string,
      handler: (event: unknown, ctx: ExtensionContext) => unknown,
    ) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    registerTool: (tool: unknown) => {
      registeredTool = tool;
    },
    registerCommand: (_name: string, command: unknown) => {
      registeredCommand = command;
    },
    sendMessage: (message: unknown, options: unknown) =>
      messages.push({ message, options }),
  } as unknown as ExtensionAPI;
  const dependencies: QuorumExtensionDependencies = {
    deliberateDecision: async (_ctx, _config, request) =>
      decisionResult(request),
    collectChanges: async () => ({ patch: "", fingerprint: "empty" }),
    splitDiff: (patch) => [patch],
    now: () => 1_000,
    reviewTimeoutMs: 1_000,
    reviewFailureRetryMs: 300_000,
    ...overrides,
  };
  quorumExtension(pi, dependencies);
  return {
    handlers,
    messages,
    get tool() {
      return registeredTool;
    },
    get command() {
      return registeredCommand;
    },
  };
}

test("cancelling any configuration prompt leaves configuration unchanged", async () => {
  const members = ["one/model", "two/model", "Done"];
  const cases: Array<Array<string | undefined>> = [
    [...members, undefined],
    [...members, "Fresh request only", undefined],
    [...members, "Fresh request only", "2", undefined],
    [
      ...members,
      "Fresh request only",
      "2",
      "On — prompt the main agent to address findings",
      undefined,
    ],
  ];
  for (const selections of cases)
    assert.equal(await chooseConfig(wizardContext(selections)), undefined);
});

test("builds a complete configuration and rejects insufficient model choices", async () => {
  const configured = await chooseConfig(
    wizardContext([
      "one/model",
      "two/model",
      "Done",
      "Bounded session summary",
      "3",
      "On — prompt the main agent to address findings",
      "2",
    ]),
  );
  assert.deepEqual(configured, {
    members: [
      { modelKey: "one/model", thinking: "high" },
      { modelKey: "two/model", thinking: "high" },
    ],
    contextMode: "session-summary",
    maxRounds: 3,
    review: { enabled: true, maxRounds: 2, autoPromptFixes: true },
  });

  const notifications: string[] = [];
  const tooFew = {
    scopedModels: [],
    modelRegistry: {
      getAvailable: () => [{ provider: "one", id: "model" }],
    },
    ui: { notify: (message: string) => notifications.push(message) },
  } as unknown as ExtensionContext;
  assert.equal(await chooseConfig(tooFew), undefined);
  assert.match(notifications[0], /at least two authenticated models/);

  const cancelledNotifications: string[] = [];
  const cancelled = wizardContext(["one/model", "Done"]);
  cancelled.ui.notify = (message) => cancelledNotifications.push(message);
  assert.equal(await chooseConfig(cancelled), undefined);
  assert.match(cancelledNotifications[0], /choose at least two members/);
});

test("registers policy, command, and quorum tool behavior", async () => {
  const deliberateRequests: DecisionRequest[] = [];
  const harness = extensionHarness({
    deliberateDecision: async (_ctx, _config, request) => {
      deliberateRequests.push(request);
      return {
        ...decisionResult(request),
        outcome: "unresolved",
        recommendation: "No material quorum was reached.",
        options: [
          {
            id: "a",
            title: "Choose A",
            rationale: "Safer",
            tradeoffs: ["Cost"],
            risks: [],
            implementationNotes: [],
          },
        ],
      };
    },
  });
  const policy = await harness.handlers.get("before_agent_start")?.[0](
    { systemPrompt: "base" },
    {} as ExtensionContext,
  );
  assert.match((policy as { systemPrompt: string }).systemPrompt, /Quorum policy/);
  for (const event of [
    "session_shutdown",
    "session_before_switch",
    "session_before_fork",
  ])
    await harness.handlers.get(event)?.[0]({}, {} as ExtensionContext);

  await saveConfig({
    members: [{ modelKey: "one/model" }, { modelKey: "two/model" }],
    contextMode: "fresh",
    maxRounds: 1,
    review: { enabled: false, maxRounds: 1, autoPromptFixes: false },
  });
  const notifications: string[] = [];
  await harness.command.handler("status", {
    ui: { notify: (message: string) => notifications.push(message) },
  } as unknown as ExtensionContext);
  assert.match(notifications[0], /Members: one\/model, two\/model/);

  const toolCtx = {
    hasUI: true,
    ui: { select: async () => "Choose A — Safer" },
  } as unknown as ExtensionContext;
  const result = await harness.tool.execute(
    "call",
    { decisions: [{ id: "one", question: "Choose?" }] },
    undefined,
    undefined,
    toolCtx,
  );
  assert.equal(deliberateRequests.length, 1);
  assert.match(result.content[0].text, /Selected direction:/);
  assert.equal(result.details.results[0].selectedOptionId, "a");

  await assert.rejects(
    harness.tool.execute(
      "call",
      { decisions: [{ id: "two", question: "Choose?" }] },
      AbortSignal.abort(),
      undefined,
      toolCtx,
    ),
    { name: "AbortError" },
  );
});

test("command configuration persists successful wizard output", async () => {
  const harness = extensionHarness();
  const notifications: string[] = [];
  const ctx = wizardContext([
    "one/model",
    "two/model",
    "Done",
    "Fresh request only",
    "2",
    "Off",
  ]);
  ctx.ui.notify = (message) => notifications.push(message);
  await harness.command.handler("configure", ctx);
  assert.deepEqual(
    (await loadConfig()).members.map((member) => member.modelKey),
    ["one/model", "two/model"],
  );
  assert.match(notifications[0], /Quorum configured/);
});

test("successful automatic review covers every part and suppresses its follow-up", async () => {
  await saveConfig({
    members: [{ modelKey: "one/model" }, { modelKey: "two/model" }],
    contextMode: "fresh",
    maxRounds: 1,
    review: { enabled: true, maxRounds: 1, autoPromptFixes: true },
  });
  let reviewCalls = 0;
  let collectionCalls = 0;
  const harness = extensionHarness({
    collectChanges: async () => {
      collectionCalls += 1;
      return { patch: "part-one\npart-two", fingerprint: "fingerprint" };
    },
    splitDiff: () => ["part-one", "part-two"],
    deliberateDecision: async (_ctx, _config, request, signal) => {
      assert.ok(signal);
      reviewCalls += 1;
      return decisionResult(request);
    },
  });
  const statuses: Array<string | undefined> = [];
  const notifications: string[] = [];
  const ctx = {
    mode: "rpc",
    ui: {
      setStatus: (_key: string, value: string | undefined) =>
        statuses.push(value),
      notify: (message: string) => notifications.push(message),
      onTerminalInput: () => {
        throw new Error("RPC must not install a terminal listener");
      },
    },
  } as unknown as ExtensionContext;
  const settled = harness.handlers.get("agent_settled")?.[0];
  assert.ok(settled);
  await settled({ type: "agent_settled" }, ctx);
  assert.equal(reviewCalls, 2);
  assert.equal(harness.messages.length, 1);
  assert.equal(harness.messages[0].options.triggerTurn, true);
  assert.match(harness.messages[0].message.content, /Diff part 2/);
  assert.equal(statuses.at(-1), undefined);
  assert.match(notifications[0], /review started/);

  await settled({ type: "agent_settled" }, ctx);
  await settled({ type: "agent_settled" }, ctx);
  assert.equal(reviewCalls, 2);
  assert.equal(collectionCalls, 3);
});

test("Ctrl-C cancels an automatic review and dismisses that fingerprint", async () => {
  await saveConfig({
    members: [{ modelKey: "one/model" }, { modelKey: "two/model" }],
    contextMode: "fresh",
    maxRounds: 1,
    review: { enabled: true, maxRounds: 1, autoPromptFixes: false },
  });
  let inputHandler: ((data: string) => unknown) | undefined;
  let markInputReady: (() => void) | undefined;
  const inputReady = new Promise<void>((resolve) => {
    markInputReady = resolve;
  });
  let reviewCalls = 0;
  const harness = extensionHarness({
    collectChanges: async () => ({ patch: "change", fingerprint: "cancelled" }),
    deliberateDecision: async (_ctx, _config, _request, signal) => {
      reviewCalls += 1;
      return new Promise<DecisionResult>((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
    },
  });
  const notifications: string[] = [];
  const ctx = {
    mode: "tui",
    ui: {
      notify: (message: string) => notifications.push(message),
      setStatus: () => undefined,
      onTerminalInput: (handler: (data: string) => unknown) => {
        inputHandler = handler;
        markInputReady?.();
        return () => undefined;
      },
    },
  } as unknown as ExtensionContext;
  const settled = harness.handlers.get("agent_settled")?.[0];
  assert.ok(settled);
  const pending = settled({ type: "agent_settled" }, ctx) as Promise<void>;
  await inputReady;
  assert.deepEqual(inputHandler?.("\u0003"), { consume: true });
  await pending;
  assert.ok(notifications.some((message) => message.includes("cancelled")));
  await settled({ type: "agent_settled" }, ctx);
  assert.equal(reviewCalls, 1);
});

test("automatic review timeout is cooled down", async () => {
  await saveConfig({
    members: [{ modelKey: "one/model" }, { modelKey: "two/model" }],
    contextMode: "fresh",
    maxRounds: 1,
    review: { enabled: true, maxRounds: 1, autoPromptFixes: false },
  });
  let reviewCalls = 0;
  const harness = extensionHarness({
    collectChanges: async () => ({ patch: "change", fingerprint: "timeout" }),
    reviewTimeoutMs: 1,
    now: () => 100,
    reviewFailureRetryMs: 1_000,
    deliberateDecision: async (_ctx, _config, _request, signal) => {
      reviewCalls += 1;
      return new Promise<DecisionResult>((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
    },
  });
  const notifications: string[] = [];
  const ctx = {
    mode: "rpc",
    ui: {
      notify: (message: string) => notifications.push(message),
      setStatus: () => undefined,
    },
  } as unknown as ExtensionContext;
  const settled = harness.handlers.get("agent_settled")?.[0];
  assert.ok(settled);
  await settled({ type: "agent_settled" }, ctx);
  assert.ok(notifications.some((message) => message.includes("timed out")));
  await settled({ type: "agent_settled" }, ctx);
  assert.equal(reviewCalls, 1);
});

test("a failed automatic review is cooled down for the same fingerprint", async () => {
  await saveConfig({
    members: [{ modelKey: "missing/one" }, { modelKey: "missing/two" }],
    contextMode: "fresh",
    maxRounds: 1,
    review: { enabled: true, maxRounds: 1, autoPromptFixes: false },
  });
  const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
  let modelLookups = 0;
  const notifications: string[] = [];
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerTool: () => undefined,
    registerCommand: () => undefined,
    sendMessage: () => undefined,
    exec: async (_command: string, args: string[]) => {
      if (args[0] === "rev-parse")
        return { stdout: "head\n", stderr: "", code: 0, killed: false };
      if (args[0] === "diff")
        return {
          stdout: "diff --git a/a.ts b/a.ts\n+change\n",
          stderr: "",
          code: 0,
          killed: false,
        };
      return { stdout: "", stderr: "", code: 0, killed: false };
    },
  } as unknown as ExtensionAPI;
  quorumExtension(pi);
  const ctx = {
    mode: "tui",
    ui: {
      notify: (message: string) => notifications.push(message),
      onTerminalInput: () => () => undefined,
      setStatus: () => undefined,
    },
    modelRegistry: {
      find: () => {
        modelLookups += 1;
        return undefined;
      },
    },
  } as unknown as ExtensionContext;
  const settled = handlers.get("agent_settled")?.[0];
  assert.ok(settled);
  await assert.rejects(
    async () => settled({ type: "agent_settled" }, ctx),
    /unavailable/,
  );
  const lookupsAfterFailure = modelLookups;
  await settled({ type: "agent_settled" }, ctx);
  assert.equal(modelLookups, lookupsAfterFailure);
  assert.ok(
    notifications.some((message) => message.includes("five minutes")),
  );
});

test("invalid automatic-review membership warns only once", async () => {
  await saveConfig({
    members: [],
    contextMode: "fresh",
    maxRounds: 1,
    review: { enabled: true, maxRounds: 1, autoPromptFixes: false },
  });
  const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
  const notifications: string[] = [];
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerTool: () => undefined,
    registerCommand: () => undefined,
  } as unknown as ExtensionAPI;
  quorumExtension(pi);
  const ctx = {
    ui: { notify: (message: string) => notifications.push(message) },
  } as unknown as ExtensionContext;
  const settled = handlers.get("agent_settled")?.[0];
  assert.ok(settled);
  await settled({ type: "agent_settled" }, ctx);
  await settled({ type: "agent_settled" }, ctx);
  assert.equal(notifications.length, 1);
});
