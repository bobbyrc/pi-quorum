import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  askReadOnlyMember,
  modelForMember,
  sessionSummary,
} from "./runner.js";
import type { MemberRunnerDependencies } from "./runner.js";

test("summarizes string-form session message content", () => {
  const ctx = {
    sessionManager: {
      buildContextEntries: () => [
        {
          type: "message",
          message: { role: "user", content: "Plain string content" },
        },
      ],
    },
  } as unknown as ExtensionContext;
  assert.equal(sessionSummary(ctx), "user: Plain string content");
});

test("summarizes only recent text message content and applies the size bound", () => {
  const entries = [
    { type: "custom" },
    ...Array.from({ length: 17 }, (_, index) => ({
      type: "message",
      message: {
        role: index === 16 ? undefined : "assistant",
        content: [
          { type: "image", data: "ignored" },
          { type: "text", text: `${index}:${"x".repeat(1_200)}` },
        ],
      },
    })),
  ];
  const ctx = {
    sessionManager: { buildContextEntries: () => entries },
  } as unknown as ExtensionContext;
  const summary = sessionSummary(ctx);
  assert.doesNotMatch(summary, /(^|\n\n)assistant: 0:/);
  assert.match(summary, /message: 16:/);
  assert.ok(summary.length <= 18_000);
});

test("resolves provider/model keys through the model registry", () => {
  const model = { provider: "one", id: "model" };
  const calls: string[][] = [];
  const ctx = {
    modelRegistry: {
      find: (provider: string, id: string) => {
        calls.push([provider, id]);
        return model;
      },
    },
  } as unknown as ExtensionContext;
  assert.equal(modelForMember(ctx, { modelKey: "one/model" }), model);
  assert.equal(modelForMember(ctx, { modelKey: "invalid" }), undefined);
  assert.deepEqual(calls, [["one", "model"]]);
});

function memberHarness(options?: {
  output?: string;
  abortDuringPrompt?: AbortController;
  abortDuringCreate?: AbortController;
}) {
  const state = {
    loaderOptions: undefined as unknown,
    sessionOptions: undefined as unknown,
    reloads: 0,
    waits: 0,
    aborts: 0,
    unsubscribes: 0,
    disposes: 0,
  };
  let listener: ((event: any) => void) | undefined;
  const session = {
    subscribe: (next: (event: any) => void) => {
      listener = next;
      return () => {
        state.unsubscribes += 1;
      };
    },
    prompt: async () => {
      options?.abortDuringPrompt?.abort();
      listener?.({ type: "message_end", message: { role: "user", content: [] } });
      if (options?.output !== undefined)
        listener?.({
          type: "message_end",
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "ignored" },
              { type: "text", text: options.output },
            ],
          },
        });
    },
    agent: {
      waitForIdle: async () => {
        state.waits += 1;
      },
    },
    abort: async () => {
      state.aborts += 1;
    },
    dispose: () => {
      state.disposes += 1;
    },
  };
  const dependencies = {
    createLoader: (loaderOptions: unknown) => {
      state.loaderOptions = loaderOptions;
      return {
        reload: async () => {
          state.reloads += 1;
        },
      };
    },
    createSession: async (sessionOptions: unknown) => {
      state.sessionOptions = sessionOptions;
      options?.abortDuringCreate?.abort();
      return { session };
    },
    getAgentDirectory: () => "/agent",
    createSessionManager: () => ({ kind: "memory" }),
  } as unknown as MemberRunnerDependencies;
  const model = { provider: "one", id: "model" };
  const ctx = {
    cwd: "/workspace",
    modelRegistry: { find: () => model },
  } as unknown as ExtensionContext;
  return { ctx, dependencies, state };
}

test("runs an isolated read-only member session and always cleans it up", async () => {
  const harness = memberHarness({ output: "x".repeat(25_000) });
  const output = await askReadOnlyMember(
    harness.ctx,
    { modelKey: "one/model", thinking: "high" },
    "prompt",
    undefined,
    harness.dependencies,
  );
  assert.equal(output.length, 24_000);
  assert.equal(harness.state.reloads, 1);
  assert.equal(harness.state.waits, 1);
  assert.equal(harness.state.unsubscribes, 1);
  assert.equal(harness.state.disposes, 1);
  assert.deepEqual(
    (harness.state.sessionOptions as { tools: string[] }).tools,
    ["read", "grep", "find", "ls"],
  );
  assert.equal(
    (harness.state.loaderOptions as { noExtensions: boolean }).noExtensions,
    true,
  );
});

test("rejects empty member output after cleaning up", async () => {
  const harness = memberHarness();
  await assert.rejects(
    askReadOnlyMember(
      harness.ctx,
      { modelKey: "one/model" },
      "prompt",
      undefined,
      harness.dependencies,
    ),
    /returned no usable answer/,
  );
  assert.equal(harness.state.unsubscribes, 1);
  assert.equal(harness.state.disposes, 1);
});

test("aborts an active member session and cleans it up", async () => {
  const controller = new AbortController();
  const harness = memberHarness({
    output: "partial",
    abortDuringPrompt: controller,
  });
  await assert.rejects(
    askReadOnlyMember(
      harness.ctx,
      { modelKey: "one/model" },
      "prompt",
      controller.signal,
      harness.dependencies,
    ),
    { name: "AbortError" },
  );
  assert.equal(harness.state.aborts, 1);
  assert.equal(harness.state.disposes, 1);
});

test("handles cancellation racing with member-session creation", async () => {
  const controller = new AbortController();
  const harness = memberHarness({ abortDuringCreate: controller });
  await assert.rejects(
    askReadOnlyMember(
      harness.ctx,
      { modelKey: "one/model" },
      "prompt",
      controller.signal,
      harness.dependencies,
    ),
    { name: "AbortError" },
  );
  assert.equal(harness.state.aborts, 1);
  assert.equal(harness.state.unsubscribes, 1);
  assert.equal(harness.state.disposes, 1);
});

test("rejects an already-aborted member call before creating a session", async () => {
  await assert.rejects(
    askReadOnlyMember(
      {} as ExtensionContext,
      { modelKey: "one/model" },
      "prompt",
      AbortSignal.abort(),
    ),
    { name: "AbortError" },
  );
});
