import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
const configRoot = await mkdtemp(join(tmpdir(), "pi-quorum-config-test-"));
process.env.XDG_CONFIG_HOME = configRoot;
const { chooseConfig, default: quorumExtension } = await import("./index.js");
const { saveConfig } = await import("./config.js");
after(() => rm(configRoot, { recursive: true, force: true }));
function wizardContext(selections) {
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
    };
}
test("cancelling any configuration prompt leaves configuration unchanged", async () => {
    const members = ["one/model", "two/model", "Done"];
    const cases = [
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
    const handlers = new Map();
    let modelLookups = 0;
    const notifications = [];
    const pi = {
        on: (event, handler) => {
            handlers.set(event, [...(handlers.get(event) ?? []), handler]);
        },
        registerTool: () => undefined,
        registerCommand: () => undefined,
        sendMessage: () => undefined,
        exec: async (_command, args) => {
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
    };
    quorumExtension(pi);
    const ctx = {
        mode: "tui",
        ui: {
            notify: (message) => notifications.push(message),
            onTerminalInput: () => () => undefined,
            setStatus: () => undefined,
        },
        modelRegistry: {
            find: () => {
                modelLookups += 1;
                return undefined;
            },
        },
    };
    const settled = handlers.get("agent_settled")?.[0];
    assert.ok(settled);
    await assert.rejects(async () => settled({ type: "agent_settled" }, ctx), /unavailable/);
    const lookupsAfterFailure = modelLookups;
    await settled({ type: "agent_settled" }, ctx);
    assert.equal(modelLookups, lookupsAfterFailure);
    assert.ok(notifications.some((message) => message.includes("five minutes")));
});
test("invalid automatic-review membership warns only once", async () => {
    await saveConfig({
        members: [],
        contextMode: "fresh",
        maxRounds: 1,
        review: { enabled: true, maxRounds: 1, autoPromptFixes: false },
    });
    const handlers = new Map();
    const notifications = [];
    const pi = {
        on: (event, handler) => {
            handlers.set(event, [...(handlers.get(event) ?? []), handler]);
        },
        registerTool: () => undefined,
        registerCommand: () => undefined,
    };
    quorumExtension(pi);
    const ctx = {
        ui: { notify: (message) => notifications.push(message) },
    };
    const settled = handlers.get("agent_settled")?.[0];
    assert.ok(settled);
    await settled({ type: "agent_settled" }, ctx);
    await settled({ type: "agent_settled" }, ctx);
    assert.equal(notifications.length, 1);
});
