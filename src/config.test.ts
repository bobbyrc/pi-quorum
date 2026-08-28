import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { QuorumConfig } from "./types.js";

const configRoot = await mkdtemp(join(tmpdir(), "pi-quorum-config-unit-"));
process.env.XDG_CONFIG_HOME = configRoot;
const { loadConfig, saveConfig } = await import("./config.js");
const configPath = join(configRoot, "pi-quorum", "config.json");

after(() => rm(configRoot, { recursive: true, force: true }));

test("returns independent defaults when configuration is missing", async () => {
  const first = await loadConfig();
  first.review.enabled = true;
  const second = await loadConfig();
  assert.equal(second.review.enabled, false);
  assert.deepEqual(second.members, []);
});

test("saves atomically with private permissions and normalizes input", async () => {
  await saveConfig({
    members: [
      { modelKey: "valid/model", thinking: "high" },
      { modelKey: "invalid" },
      null,
    ],
    contextMode: "invalid",
    maxRounds: 99,
    review: { enabled: true, maxRounds: 0, autoPromptFixes: false },
  } as unknown as QuorumConfig);
  const loaded = await loadConfig();
  assert.deepEqual(loaded.members, [
    { modelKey: "valid/model", thinking: "high" },
  ]);
  assert.equal(loaded.contextMode, "fresh");
  assert.equal(loaded.maxRounds, 3);
  assert.equal(loaded.review.maxRounds, 1);
  assert.equal(loaded.review.autoPromptFixes, false);
  assert.match(await readFile(configPath, "utf8"), /"valid\/model"/);
  if (process.platform !== "win32") {
    assert.equal((await stat(configPath)).mode & 0o777, 0o600);
    assert.equal((await stat(join(configRoot, "pi-quorum"))).mode & 0o777, 0o700);
  }
});

test("reports malformed configuration instead of silently resetting it", async () => {
  await writeFile(configPath, "{not json", "utf8");
  await assert.rejects(loadConfig(), /Unable to read pi-quorum configuration/);
});
