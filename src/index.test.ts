import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const configRoot = await mkdtemp(join(tmpdir(), "pi-quorum-config-test-"));
process.env.XDG_CONFIG_HOME = configRoot;
const { chooseConfig, default: quorumExtension } = await import("./index.js");
const { saveConfig } = await import("./config.js");

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
